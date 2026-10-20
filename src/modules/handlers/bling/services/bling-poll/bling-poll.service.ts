import { Op } from "sequelize";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import { getBlingIntegration } from "../../api/bling_api.service";
import {
  getBlingInvoiceReferenceDate,
  isKnownBlingInvoiceBeforeCutoff,
} from "../bling/bling-invoice-cutoff";
import {
  BlingQuery,
  blingInvoiceFetchJobId,
  buildBlingInvoiceFetchPayload,
  fetchBlingListPage,
  paginateBling,
} from "../bling-sync/helpers/bling-list";
import { BULK_FORCE_UPDATE_PRIORITY } from "../bling-orders/bling-order.queue";
import invoiceService from "../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import ordersService from "../../../../sales/orders/order/orders.service";

// TEMPORÁRIO: polling que substitui os webhooks da Bling enquanto eles não chegam.
// Desligar com BLING_POLL_ENABLED=false — o boot remove os dois agendamentos do Redis.
// Lido na hora de agendar (não no import): server.ts importa módulos antes do dotenv carregar.
export function isBlingPollEnabled(): boolean {
  return process.env.BLING_POLL_ENABLED?.trim().toLowerCase() === "true";
}

// Job de 1min: notas/pedidos que existem na Bling e não no banco (scheduler id fixo no BLING_RECONCILER).
export const BLING_POLL_NEW_RECORDS_SCHEDULER_ID =
  "bling-reconciler-poll-new-records";
export const BLING_POLL_NEW_RECORDS_INTERVAL_MS = 60 * 1000;

// Job de 20min: últimas alterações de notas/pedidos (scheduler id fixo no BLING_RECONCILER).
export const BLING_POLL_RECENT_CHANGES_SCHEDULER_ID =
  "bling-reconciler-poll-recent-changes";
export const BLING_POLL_RECENT_CHANGES_INTERVAL_MS = 20 * 60 * 1000;

// Teto por listagem no job de alterações.
const RECENT_CHANGES_LIMIT = 50;

// Atualização vai pro fim das duas filas (BLING_API_FETCH usa 1–4, BLING_ORDER_INGESTION 1–2):
// criação (prioridade de webhook) sempre fura a fila na frente.
const UPDATE_JOB_PRIORITY = BULK_FORCE_UPDATE_PRIORITY;
// Nome dos jobs de atualização: o gate do job de novos ignora esses pendentes.
export const BLING_POLL_UPDATE_JOB_NAME = "bling-poll-update";
const UPDATE_JOB_OPTIONS = {
  priority: UPDATE_JOB_PRIORITY,
  name: BLING_POLL_UPDATE_JOB_NAME,
};

// Marca por registro enfileirado no job de 1min: evita reenfileirar a cada minuto
// enquanto o job ainda não persistiu (ou se nunca persistir) — reenvia só após o TTL.
const ENQUEUED_MARK_TTL_S = 30 * 60;
const ENQUEUED_MARK_PREFIX = "bling-poll:enqueued";

// Última situação vista por NF-e: listagem de /nfe não tem data de alteração, mudança é detectada por aqui.
const INVOICE_SITUATION_PREFIX = "bling-poll:invoice-situacao";
const INVOICE_SITUATION_TTL_S = 7 * 24 * 3600;

// Início da última rodada de alterações de pedido (dataAlteracaoInicial da próxima); margem cobre relógio/atraso.
const ORDERS_CHANGED_CURSOR_KEY = "bling-poll:orders-changed-cursor";
const ORDERS_CHANGED_CURSOR_MARGIN_MS = 60 * 1000;
const ORDERS_CHANGED_CURSOR_TTL_S = 7 * 24 * 3600;

const INVOICE_ENDPOINT = "/nfe";
const ORDER_ENDPOINT = "/pedidos/vendas";

// NF-e saída, saída cancelada e entrada: tipo 1 sem `situacao` não traz canceladas (confirmado na API).
const INVOICE_LISTINGS: BlingQuery[] = [
  { tipo: 1 },
  { tipo: 1, situacao: 2 },
  { tipo: 0 },
];

interface BlingInvoiceSummary {
  id: number;
  numero?: string;
  situacao?: number;
  dataEmissao?: string;
  dataOperacao?: string;
}

interface BlingOrderSummary {
  id: number;
  numero?: number | string;
  situacao?: { id?: number; valor?: number };
}

// Só o que o poll usa das filas de destino (BLING_API_FETCH e BLING_ORDER_INGESTION).
type EnqueueTarget = {
  add: (
    data: any,
    jobId: string,
    options?: { priority?: number; name?: string },
  ) => Promise<unknown>;
  hasPendingJobs: () => Promise<boolean>;
  hasPendingJobsExcept: (names: string[]) => Promise<boolean>;
};

// Filas de destino injetadas por queues/index.ts (no worker-automation as duas são workless).
export interface BlingPollQueues {
  apiFetch: EnqueueTarget;
  orderIngestion: EnqueueTarget;
}

// Registro faltante pronto pra enfileirar, com a chave da marca anti-reenvio.
interface PendingEnqueue {
  markKey: string;
  enqueue: () => Promise<unknown>;
}

// "YYYY-MM-DD HH:mm:ss" em BRT — /nfe com data sem hora não filtra o dia corrente, só com hora.
function toBlingDateTime(date: Date): string {
  return date.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

// Ontem (BRT) como "YYYY-MM-DD": janela do job de 1min, cobre a virada do dia.
function yesterdayBrt(): string {
  return toBlingDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000)).slice(0, 10);
}

// Mesmo corte que o webhook aplica antes de enfileirar nota.
function afterInvoiceCutoff(invoices: BlingInvoiceSummary[]): BlingInvoiceSummary[] {
  return invoices.filter((invoice) => {
    const referenceDate = getBlingInvoiceReferenceDate(invoice);
    return !(referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate));
  });
}

// Chave Redis da última situação vista de uma NF-e.
function situationKey(invoiceId: number): string {
  return `${INVOICE_SITUATION_PREFIX}:${invoiceId}`;
}

// Junta o resultado das duas metades (notas/pedidos) de uma rodada: loga e falha o job se alguma quebrou.
function reportRound(
  label: string,
  invoices: PromiseSettledResult<number>,
  orders: PromiseSettledResult<number>,
): void {
  const count = (result: PromiseSettledResult<number>) =>
    result.status === "fulfilled" ? result.value : "erro";
  console.log(
    `[BlingPoll] ${label}: ${count(invoices)} nota(s) e ${count(orders)} pedido(s) enfileirado(s).`,
  );

  const failures = [invoices, orders].filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length) {
    throw new Error(
      failures.map((f) => f.reason?.message ?? String(f.reason)).join(" | "),
    );
  }
}

// Polling da Bling com os mesmos payloads do webhook (BLING_API_FETCH / BLING_ORDER_INGESTION).
// Tasks poll-new-records (1min) e poll-recent-changes (20min) do BLING_RECONCILER.
export class BlingPollService {
  constructor(private readonly queues: BlingPollQueues) {}

  // 1min: NF-e (saída, cancelada, entrada) e pedidos desde ontem, sem limite, que ainda não existem no banco
  // (nota que só existe como stub do pedido conta como faltante).
  // Roda mesmo com atualização na fila: criação tem prioridade e entra na frente.
  async pollNewRecords(): Promise<void> {
    if (!(await this.targetQueuesAreClear({ ignoreUpdateJobs: true }))) return;

    const integration = await getBlingIntegration("Bling");
    if (!integration) {
      console.warn("[BlingPoll] Integration não encontrada. Pulando.");
      return;
    }

    const since = yesterdayBrt();
    const [invoices, orders] = await Promise.allSettled([
      this.enqueueMissingInvoices(integration.id, `${since} 00:00:00`),
      this.enqueueMissingOrders(integration.id, since),
    ]);
    reportRound(`Novos desde ${since}`, invoices, orders);
  }

  // 20min: últimos 50 pedidos alterados e NF-e (últimas 50 por listagem) que mudaram de situação.
  // Só com as duas filas totalmente vazias (inclui criação e as próprias atualizações anteriores).
  async pollRecentChanges(): Promise<void> {
    if (!(await this.targetQueuesAreClear({ ignoreUpdateJobs: false }))) return;

    const startedAt = new Date();
    const [invoices, orders] = await Promise.allSettled([
      this.refetchChangedInvoices(),
      this.refetchChangedOrders(startedAt),
    ]);
    reportRound("Alterações", invoices, orders);
  }

  // Só busca com as duas filas de destino vazias: não compete com o backlog pelo rate limit da Bling.
  // ignoreUpdateJobs: jobs de atualização do próprio poll (prioridade baixa) não bloqueiam.
  private async targetQueuesAreClear({
    ignoreUpdateJobs,
  }: {
    ignoreUpdateJobs: boolean;
  }): Promise<boolean> {
    const isPending = (target: EnqueueTarget) =>
      ignoreUpdateJobs
        ? target.hasPendingJobsExcept([BLING_POLL_UPDATE_JOB_NAME])
        : target.hasPendingJobs();
    const [apiFetchPending, orderIngestionPending] = await Promise.all([
      isPending(this.queues.apiFetch),
      isPending(this.queues.orderIngestion),
    ]);
    if (!apiFetchPending && !orderIngestionPending) return true;

    const busy = [
      apiFetchPending && "BLING_API_FETCH",
      orderIngestionPending && "BLING_ORDER_INGESTION",
    ].filter(Boolean);
    console.log(
      `[BlingPoll] Pulando rodada — ainda há job(s) pendente(s) em ${busy.join(", ")}.`,
    );
    return false;
  }

  // NF-e faltantes → BLING_API_FETCH; listagens em paralelo, páginas de cada uma em sequência.
  private async enqueueMissingInvoices(
    integrationId: string,
    since: string,
  ): Promise<number> {
    const perListing = await Promise.all(
      INVOICE_LISTINGS.map(async (query) => {
        let enqueued = 0;
        for await (const page of paginateBling<BlingInvoiceSummary>(
          INVOICE_ENDPOINT,
          { ...query, dataEmissaoInicial: since },
        )) {
          const missing = await this.filterMissingOrStubInvoices(
            integrationId,
            afterInvoiceCutoff(page),
          );
          // jobId compartilhado com o fetch que o pedido enfileira ao criar o stub (bling-order.service).
          enqueued += await this.enqueueUnmarked(
            missing.map((invoice) => ({
              markKey: `invoice:${invoice.id}`,
              enqueue: () =>
                this.queues.apiFetch.add(
                  buildBlingInvoiceFetchPayload(invoice),
                  blingInvoiceFetchJobId(invoice.id),
                ),
            })),
          );
          // Registra a situação de criação pro job de alterações não refazer o fetch à toa.
          await this.recordSituations(missing, { onlyIfAbsent: true });
        }
        return enqueued;
      }),
    );
    return perListing.reduce((sum, count) => sum + count, 0);
  }

  // Pedidos faltantes → BLING_ORDER_INGESTION.
  private async enqueueMissingOrders(
    integrationId: string,
    since: string,
  ): Promise<number> {
    let enqueued = 0;

    for await (const page of paginateBling<BlingOrderSummary>(ORDER_ENDPOINT, {
      dataInicial: since,
    })) {
      const missing = await this.filterMissingOrders(integrationId, page);

      // jobId igual ao do webhook de criação: deduplica se o webhook voltar a chegar.
      enqueued += await this.enqueueUnmarked(
        missing.map((order) => ({
          markKey: `order:${order.id}`,
          enqueue: () =>
            this.queues.orderIngestion.add(
              {
                event: "order.created",
                action: "created",
                data: {
                  id: order.id,
                  numero: order.numero,
                  situacao: order.situacao,
                },
              },
              `bling-order-created-${order.id}`,
            ),
        })),
      );
    }

    return enqueued;
  }

  // Últimas 50 de cada listagem de NF-e; refaz o fetch das que mudaram de situação (ou nunca vistas).
  private async refetchChangedInvoices(): Promise<number> {
    const pages = await Promise.all(
      INVOICE_LISTINGS.map((query) =>
        fetchBlingListPage<BlingInvoiceSummary>(
          INVOICE_ENDPOINT,
          query,
          1,
          RECENT_CHANGES_LIMIT,
        ),
      ),
    );
    const changed = await this.filterChangedSituations(
      afterInvoiceCutoff(pages.flat()),
    );

    // jobId com a situação: mesma mudança não duplica, mudança nova gera job novo.
    await Promise.all(
      changed.map((invoice) =>
        this.queues.apiFetch.add(
          buildBlingInvoiceFetchPayload(invoice),
          `bling-poll-invoice-refetch-${invoice.id}-${invoice.situacao}`,
          UPDATE_JOB_OPTIONS,
        ),
      ),
    );
    await this.recordSituations(changed, { onlyIfAbsent: false });
    return changed.length;
  }

  // Até 50 pedidos alterados desde a última rodada → order.updated (cria se ainda não existir).
  private async refetchChangedOrders(startedAt: Date): Promise<number> {
    const cursor = await redisService.get<string>(ORDERS_CHANGED_CURSOR_KEY);
    const from = new Date(
      (cursor
        ? Date.parse(cursor)
        : startedAt.getTime() - BLING_POLL_RECENT_CHANGES_INTERVAL_MS) -
        ORDERS_CHANGED_CURSOR_MARGIN_MS,
    );

    const orders = await fetchBlingListPage<BlingOrderSummary>(
      ORDER_ENDPOINT,
      { dataAlteracaoInicial: toBlingDateTime(from) },
      1,
      RECENT_CHANGES_LIMIT,
    );

    // jobId igual ao do webhook de atualização; prioridade baixa (criação fura a fila).
    await Promise.all(
      orders.map((order) =>
        this.queues.orderIngestion.add(
          { event: "order.updated", action: "updated", data: { id: order.id } },
          `bling-order-updated-${order.id}`,
          UPDATE_JOB_OPTIONS,
        ),
      ),
    );

    // Cursor só avança com sucesso: rodada pulada pelo gate/falha é coberta pela próxima.
    await redisService.set(ORDERS_CHANGED_CURSOR_KEY, startedAt.toISOString(), {
      mode: "EX",
      duration: ORDERS_CHANGED_CURSOR_TTL_S,
    });
    return orders.length;
  }

  // Uma query por página: notas sem linha completa em invoices — ausentes ou só stub
  // (createStub não grava source_payload; o upsert do BLING_API_FETCH sempre grava).
  private async filterMissingOrStubInvoices(
    integrationId: string,
    invoices: BlingInvoiceSummary[],
  ): Promise<BlingInvoiceSummary[]> {
    if (!invoices.length) return [];

    const existing = await invoiceService.findAll({
      where: {
        integrations_id: integrationId,
        id_system: { [Op.in]: invoices.map((invoice) => String(invoice.id)) },
        source_payload: { [Op.ne]: null },
      },
      attributes: ["id_system"],
    });
    const known = new Set(existing.map((invoice) => invoice.id_system));
    return invoices.filter((invoice) => !known.has(String(invoice.id)));
  }

  // Uma query por página: pedidos cujo id da Bling ainda não está em orders.id_order_system.
  private async filterMissingOrders(
    integrationId: string,
    orders: BlingOrderSummary[],
  ): Promise<BlingOrderSummary[]> {
    if (!orders.length) return [];

    const existing = await ordersService.findAll({
      where: {
        integrations_id: integrationId,
        id_order_system: { [Op.in]: orders.map((order) => String(order.id)) },
      },
      attributes: ["id_order_system"],
    });
    const known = new Set(existing.map((order) => order.id_order_system));
    return orders.filter((order) => !known.has(String(order.id)));
  }

  // MGET das situações vistas; nunca vista conta como mudança (pega o que mudou com o webhook fora).
  private async filterChangedSituations(
    invoices: BlingInvoiceSummary[],
  ): Promise<BlingInvoiceSummary[]> {
    const unique = [...new Map(invoices.map((inv) => [inv.id, inv])).values()];
    if (!unique.length) return [];

    const seen = await redisService.client.mget(
      unique.map((invoice) => situationKey(invoice.id)),
    );
    return unique.filter(
      (invoice, index) => seen[index] !== String(invoice.situacao),
    );
  }

  // Grava a situação vista em lote; onlyIfAbsent (NX) não sobrescreve o que o job de alterações já viu.
  private async recordSituations(
    invoices: BlingInvoiceSummary[],
    { onlyIfAbsent }: { onlyIfAbsent: boolean },
  ): Promise<void> {
    if (!invoices.length) return;

    const pipeline = redisService.client.pipeline();
    invoices.forEach((invoice) => {
      const key = situationKey(invoice.id);
      const value = String(invoice.situacao);
      if (onlyIfAbsent) {
        pipeline.set(key, value, "EX", INVOICE_SITUATION_TTL_S, "NX");
      } else {
        pipeline.set(key, value, "EX", INVOICE_SITUATION_TTL_S);
      }
    });
    await pipeline.exec();
  }

  // SET NX da marca antes de enfileirar; se o add falhar, apaga a marca pra tentar no próximo minuto.
  private async enqueueUnmarked(items: PendingEnqueue[]): Promise<number> {
    const results = await Promise.all(
      items.map(async ({ markKey, enqueue }) => {
        const key = `${ENQUEUED_MARK_PREFIX}:${markKey}`;
        const marked = await redisService.set(key, "1", {
          mode: "EX",
          duration: ENQUEUED_MARK_TTL_S,
          condition: "NX",
        });
        if (!marked) return false;

        try {
          await enqueue();
          return true;
        } catch (err) {
          await redisService.delete(key).catch(() => {});
          throw err;
        }
      }),
    );
    return results.filter(Boolean).length;
  }
}

export default BlingPollService;
