import { v4 as uuidv4 } from "uuid";
import { blingApi, getBlingIntegration } from "../../api/bling_api.service";
import { blingGet } from "../bling/helpers/get-with-sleep";
import {
  BULK_FORCE_UPDATE_PRIORITY,
  BlingOrderQueue,
} from "../bling-orders/bling-order.queue";
import integrationOrderStatusMappingService from "../../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import {
  ApiFetchJobPayload,
  BlingApiFetchQueue,
} from "../bling/queues/bling-api-fetch.queue";
import {
  BLING_INVOICE_CUTOFF_DATE_PARAM,
  getBlingInvoiceReferenceDate,
  isKnownBlingInvoiceBeforeCutoff,
} from "../bling/bling-invoice-cutoff";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import {
  BlingSyncQueues,
  INVOICE_STEPS,
  InvoiceStep,
  PopulateByIdEntity,
  PopulateByIdItemResult,
  PopulateByIdRequest,
  PopulateRequest,
  PopulateRun,
  PopulateStep,
  PopulateStepResult,
} from "./bling-sync.types";

const POPULATE_LOCK_KEY = "bling-sync:populate:lock";
const POPULATE_RUN_KEY = "bling-sync:populate:run";
// Lock curto + refresh periódico: se o processo cair no meio, libera sozinho.
const POPULATE_LOCK_TTL_MS = 30 * 60 * 1000;
const POPULATE_RUN_TTL_S = 7 * 24 * 3600;
const PAGE_SIZE = 100;
const QUEUE_POLL_MS = 5_000;

type BlingInvoiceResource = "invoice" | "consumer_invoice";

interface BlingInvoiceSummary {
  id: number;
  numero?: string;
  situacao?: number;
  dataEmissao?: string;
  dataOperacao?: string;
}

const INVOICE_STEP_CONFIG: Record<
  InvoiceStep,
  {
    resource: BlingInvoiceResource;
    endpoint: string;
    // Bling /nfe sem `tipo` só devolve saída — canceladas precisam varrer os dois.
    queries: Record<string, number>[];
    cancelled?: boolean;
  }
> = {
  nfe_out: { resource: "invoice", endpoint: "/nfe", queries: [{ tipo: 1 }] },
  nfe_in: { resource: "invoice", endpoint: "/nfe", queries: [{ tipo: 0 }] },
  nfe_cancelled: {
    resource: "invoice",
    endpoint: "/nfe",
    queries: [
      { tipo: 1, situacao: 2 },
      { tipo: 0, situacao: 2 },
    ],
    cancelled: true,
  },
  nfce: {
    resource: "consumer_invoice",
    endpoint: "/nfce",
    queries: [{ tipo: 1 }],
  },
};

const BY_ID_INVOICE_CONFIG: Partial<
  Record<PopulateByIdEntity, { resource: BlingInvoiceResource; endpoint: string }>
> = {
  nfe: { resource: "invoice", endpoint: "/nfe" },
  nfce: { resource: "consumer_invoice", endpoint: "/nfce" },
};

type BlingQuery = Record<string, string | number | number[]>;

export class BlingSyncInputError extends Error {}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function mapInvoiceStatus(situacao?: number): "OPEN" | "CANCELLED" {
  return situacao === 2 ? "CANCELLED" : "OPEN";
}

function buildApiFetchPayload(
  resource: ApiFetchJobPayload["resource"],
  blingId: number,
  partialData?: ApiFetchJobPayload["apiFetch"]["partialData"],
): ApiFetchJobPayload {
  return {
    eventId: `migration-${resource}-${blingId}-${uuidv4()}`,
    resource,
    action: "created",
    companyId: "",
    date: new Date().toISOString(),
    rawData: {},
    apiFetch: {
      resource,
      blingId,
      action: "created",
      companyId: "",
      ...(partialData ? { partialData } : {}),
    },
  };
}

function productJobId(blingId: number) {
  return `migration-product-fetch-${blingId}`;
}

function invoiceJobId(
  resource: BlingInvoiceResource,
  blingId: number,
  cancelled = false,
) {
  return `migration-${resource}${cancelled ? "-cancelled" : ""}-fetch-${blingId}`;
}

function orderJobId(blingId: number) {
  return `bling-order-force-update-${blingId}`;
}

// Bling espera filtro de lista como `chave[]=a&chave[]=b`.
function toBlingParams(query: BlingQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(`${key}[]`, String(item)));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

async function* paginateBling<T>(
  endpoint: string,
  query: BlingQuery = {},
): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const { data } = await blingGet<{ data: T[] }>(endpoint, blingApi, {
      params: toBlingParams({ ...query, pagina: page, limite: PAGE_SIZE }),
    });
    const items = data?.data ?? [];
    if (!items.length) return;
    yield items;
    if (items.length < PAGE_SIZE) return;
  }
}

async function fetchBlingById<T>(endpoint: string, id: number): Promise<T> {
  const { data } = await blingGet<{ data: T }>(`${endpoint}/${id}`, blingApi);
  if (!data?.data) throw new Error("Registro não encontrado na Bling");
  return data.data;
}

function describeBlingError(err: any): string {
  const status = err?.response?.status;
  if (status === 404) return "Registro não encontrado na Bling";
  return status ? `Bling respondeu ${status}` : err?.message ?? "Erro desconhecido";
}

export class BlingSyncService {
  async startPopulate(
    request: PopulateRequest,
    queues: BlingSyncQueues,
    requestedBy: PopulateRun["requestedBy"],
  ): Promise<PopulateRun | null> {
    // Resolve antes do lock: status inválido vira 400 sem ocupar a execução.
    const orderSituationIds =
      request.entities.includes("orders") && request.orderStatus
        ? await this.resolveOrderSituationIds(request.orderStatus)
        : null;

    const runId = uuidv4();
    const acquired = await redisService.set(POPULATE_LOCK_KEY, runId, {
      mode: "PX",
      duration: POPULATE_LOCK_TTL_MS,
      condition: "NX",
    });
    if (!acquired) return null;

    const run: PopulateRun = {
      runId,
      status: "RUNNING",
      steps: this.resolveSteps(request),
      limit: request.limit ?? null,
      orderSituationIds,
      requestedBy,
      currentStep: null,
      results: [],
      startedAt: new Date().toISOString(),
    };
    await this.saveRun(run);

    // Fire-and-forget: a importação inteira pode levar horas, o status fica no Redis.
    void this.executeRun(run, queues);

    return run;
  }

  async getLastRun(): Promise<PopulateRun | null> {
    return redisService.get<PopulateRun>(POPULATE_RUN_KEY);
  }

  async populateByIds(
    { entity, ids }: PopulateByIdRequest,
    queues: BlingSyncQueues,
  ): Promise<PopulateByIdItemResult[]> {
    if (entity === "order") return this.enqueueOrders(ids, queues);
    if (entity === "product") return this.enqueueProductsByIds(ids, queues);
    return this.enqueueInvoicesByIds(entity, ids, queues);
  }

  // Produtos sempre antes das notas: item de nota resolve produto já persistido.
  private resolveSteps(request: PopulateRequest): PopulateStep[] {
    const steps: PopulateStep[] = [];
    if (request.entities.includes("products")) steps.push("products");
    if (request.entities.includes("invoices")) {
      const chosen = request.invoiceTypes ?? INVOICE_STEPS;
      steps.push(...INVOICE_STEPS.filter((step) => chosen.includes(step)));
    }
    if (request.entities.includes("orders")) steps.push("orders");
    return steps;
  }

  private async resolveOrderSituationIds(
    orderStatus: string[],
  ): Promise<number[]> {
    const integration = await getBlingIntegration();
    const externalIds =
      await integrationOrderStatusMappingService.findExternalStatusIdsByNormalizedStatus(
        orderStatus,
        integration.id,
      );

    if (!externalIds.length) {
      throw new BlingSyncInputError(
        `Nenhuma situação da Bling mapeada para: ${orderStatus.join(", ")}`,
      );
    }
    return externalIds.map(Number);
  }

  private async executeRun(run: PopulateRun, queues: BlingSyncQueues) {
    const lockRefresh = setInterval(() => {
      redisService.client
        .pexpire(POPULATE_LOCK_KEY, POPULATE_LOCK_TTL_MS)
        .catch(() => {});
    }, POPULATE_LOCK_TTL_MS / 3);

    try {
      for (const step of run.steps) {
        run.currentStep = step;
        await this.saveRun(run);

        const result =
          step === "products"
            ? await this.populateProducts(run.limit, queues.apiFetchQueue)
            : step === "orders"
              ? await this.populateOrders(
                  run.limit,
                  run.orderSituationIds,
                  queues.orderQueue,
                )
              : await this.populateInvoices(step, run.limit, queues.apiFetchQueue);

        run.results.push({ ...result, finishedAt: new Date().toISOString() });
        await this.saveRun(run);
      }
      run.status = "FINISHED";
    } catch (err: any) {
      console.error(`[BlingSync] Run ${run.runId} falhou:`, err?.message);
      run.status = "FAILED";
      run.error = describeBlingError(err);
    } finally {
      clearInterval(lockRefresh);
      run.currentStep = null;
      run.finishedAt = new Date().toISOString();
      await this.saveRun(run).catch(() => {});
      await this.releaseLock(run.runId).catch(() => {});
    }
  }

  private async populateProducts(
    limit: number | null,
    queue: BlingApiFetchQueue,
  ): Promise<PopulateStepResult> {
    const jobIds: string[] = [];

    for await (const page of paginateBling<{ id: number }>("/produtos")) {
      const batch = limit ? page.slice(0, limit - jobIds.length) : page;
      await Promise.all(
        batch.map((product) =>
          queue.add(
            buildApiFetchPayload("product", product.id),
            productJobId(product.id),
          ),
        ),
      );
      jobIds.push(...batch.map((product) => productJobId(product.id)));
      console.log(`[BlingSync] Produtos enfileirados: ${jobIds.length}`);
      if (limit && jobIds.length >= limit) break;
    }

    await this.waitForJobs(queue, jobIds, "products");
    return { step: "products", enqueued: jobIds.length, skipped: 0 };
  }

  private async populateInvoices(
    step: InvoiceStep,
    limit: number | null,
    queue: BlingApiFetchQueue,
  ): Promise<PopulateStepResult> {
    const config = INVOICE_STEP_CONFIG[step];
    const jobIds: string[] = [];
    let skipped = 0;

    for (const query of config.queries) {
      if (limit && jobIds.length >= limit) break;

      for await (const page of paginateBling<BlingInvoiceSummary>(
        config.endpoint,
        { ...query, dataEmissaoInicial: BLING_INVOICE_CUTOFF_DATE_PARAM },
      )) {
        const eligible = page.filter((invoice) => {
          const referenceDate = getBlingInvoiceReferenceDate(invoice);
          return !(referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate));
        });
        skipped += page.length - eligible.length;

        const batch = limit ? eligible.slice(0, limit - jobIds.length) : eligible;
        await Promise.all(
          batch.map((invoice) =>
            queue.add(
              buildApiFetchPayload(config.resource, invoice.id, {
                blingId: invoice.id,
                number: invoice.numero,
                id_system: String(invoice.id),
                status: config.cancelled
                  ? "CANCELLED"
                  : mapInvoiceStatus(invoice.situacao),
              }),
              invoiceJobId(config.resource, invoice.id, config.cancelled),
            ),
          ),
        );
        jobIds.push(
          ...batch.map((invoice) =>
            invoiceJobId(config.resource, invoice.id, config.cancelled),
          ),
        );
        console.log(`[BlingSync] ${step} enfileiradas: ${jobIds.length}`);
        if (limit && jobIds.length >= limit) break;
      }
    }

    await this.waitForJobs(queue, jobIds, step);
    return { step, enqueued: jobIds.length, skipped };
  }

  // Prioridade de bulk: importação em massa nunca fura webhook/automação.
  private async populateOrders(
    limit: number | null,
    situationIds: number[] | null,
    queue: BlingOrderQueue,
  ): Promise<PopulateStepResult> {
    const jobIds: string[] = [];
    const query: BlingQuery = situationIds ? { idsSituacoes: situationIds } : {};

    for await (const page of paginateBling<{ id: number }>(
      "/pedidos/vendas",
      query,
    )) {
      const batch = limit ? page.slice(0, limit - jobIds.length) : page;
      await Promise.all(
        batch.map((order) =>
          queue.add(
            { event: "order.updated", action: "updated", data: { id: order.id } },
            orderJobId(order.id),
            { priority: BULK_FORCE_UPDATE_PRIORITY },
          ),
        ),
      );
      jobIds.push(...batch.map((order) => orderJobId(order.id)));
      console.log(`[BlingSync] Pedidos enfileirados: ${jobIds.length}`);
      if (limit && jobIds.length >= limit) break;
    }

    await this.waitForJobs(queue, jobIds, "orders");
    return { step: "orders", enqueued: jobIds.length, skipped: 0 };
  }

  // Espera só os jobs desta execução — esperar a fila zerar travaria com tráfego de webhook.
  private async waitForJobs(
    queue: BlingApiFetchQueue | BlingOrderQueue,
    jobIds: string[],
    label: string,
  ) {
    while (jobIds.length) {
      const pendingIds = await queue.getPendingJobIds();
      const pending = jobIds.filter((id) => pendingIds.has(id)).length;
      if (!pending) return;
      console.log(`[BlingSync] ${label}: ${pending} job(s) pendente(s)`);
      await sleep(QUEUE_POLL_MS);
    }
  }

  private async enqueueProductsByIds(
    ids: number[],
    queues: BlingSyncQueues,
  ): Promise<PopulateByIdItemResult[]> {
    return Promise.all(
      ids.map(async (id): Promise<PopulateByIdItemResult> => {
        try {
          await fetchBlingById<{ id: number }>("/produtos", id);
          await queues.apiFetchQueue.add(
            buildApiFetchPayload("product", id),
            productJobId(id),
          );
          return { id, status: "ENQUEUED" };
        } catch (err) {
          return { id, status: "FAILED", reason: describeBlingError(err) };
        }
      }),
    );
  }

  private async enqueueInvoicesByIds(
    entity: PopulateByIdEntity,
    ids: number[],
    queues: BlingSyncQueues,
  ): Promise<PopulateByIdItemResult[]> {
    const { resource, endpoint } = BY_ID_INVOICE_CONFIG[entity]!;

    return Promise.all(
      ids.map(async (id): Promise<PopulateByIdItemResult> => {
        try {
          const invoice = await fetchBlingById<BlingInvoiceSummary>(endpoint, id);
          const referenceDate = getBlingInvoiceReferenceDate(invoice);
          if (referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate)) {
            return {
              id,
              status: "SKIPPED",
              reason: `Nota anterior ao corte (${BLING_INVOICE_CUTOFF_DATE_PARAM})`,
            };
          }

          await queues.apiFetchQueue.add(
            buildApiFetchPayload(resource, id, {
              blingId: id,
              number: invoice.numero,
              id_system: String(id),
              status: mapInvoiceStatus(invoice.situacao),
            }),
            invoiceJobId(resource, id),
          );
          return { id, status: "ENQUEUED" };
        } catch (err) {
          return { id, status: "FAILED", reason: describeBlingError(err) };
        }
      }),
    );
  }

  // Mesmo payload do force-update: "order.updated" cria o pedido se ainda não existir.
  private async enqueueOrders(
    ids: number[],
    queues: BlingSyncQueues,
  ): Promise<PopulateByIdItemResult[]> {
    return Promise.all(
      ids.map(async (id): Promise<PopulateByIdItemResult> => {
        try {
          await queues.orderQueue.add(
            { event: "order.updated", action: "updated", data: { id } },
            orderJobId(id),
          );
          return { id, status: "ENQUEUED" };
        } catch (err: any) {
          return { id, status: "FAILED", reason: err?.message };
        }
      }),
    );
  }

  private async saveRun(run: PopulateRun) {
    await redisService.set(POPULATE_RUN_KEY, run, {
      mode: "EX",
      duration: POPULATE_RUN_TTL_S,
    });
  }

  private async releaseLock(runId: string) {
    const owner = await redisService.get<string>(POPULATE_LOCK_KEY);
    if (owner === runId) await redisService.delete(POPULATE_LOCK_KEY);
  }
}

export default new BlingSyncService();
