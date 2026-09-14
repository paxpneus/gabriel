import { AxiosInstance } from "axios";
import ordersService from "../../../../../sales/orders/order/orders.service";
import {
  nextRemoveOnQueue,
  nextStepDelayedOnQueue,
  getJob,
} from "../../../../../../shared/types/queue/base-queue";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  FullOrder,
  OrderInternalStatus,
} from "../../../../../sales/orders/order/orders.types";
import { setDelayBasedOnDate } from "../../../../../../shared/utils/queues/setDelay";
import { blingGet, blingPatch } from "../../bling/helpers/get-with-sleep";
import { mapOrderInternalStatus } from "../../../../../../shared/utils/normalizers/bling/status-mapper";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import { nowTz, startOfDayTz } from "../../../../../../shared/utils/normalizers/date";
import { withOrderLock } from "../../../../../../shared/utils/base-models/base-queue-service";

/**
 * Rebusca o pedido só com internal_status e actual_situation para confirmar
 * que ele ainda está de fato em WAITING CHANNEL VALIDATION (748743 na
 * Bling). Evita processar um pedido que já mudou de situação entre o
 * enqueue e o processamento. Extraída de MLOrderSyncQueue (usada tanto lá
 * quanto internamente por scheduleNfe abaixo).
 *
 * Usa `actual_situation` (não `source_payload.situacao.id`): CNPJQueue
 * avança o pedido pra 748743 direto na Bling (applyWaitingNfeStatus) e só
 * grava `internal_status` localmente — não reescreve `source_payload`, que
 * só é atualizado por um webhook completo (create/updateOrderFromBling).
 * Checar `source_payload` aqui fazia essa checagem falhar sempre logo
 * depois do avanço pelo CNPJQueue, já que o snapshot ainda tinha a
 * situação antiga, mesmo com `internal_status` já correto — derrubando o
 * agendamento de NFe de todo pedido que passa por ali.
 */
export async function isEligibleForSync(orderId: string): Promise<boolean> {
  const orderData = await ordersService.findById(orderId, {
    attributes: ["internal_status", "actual_situation"],
  });

  if (!orderData) return false;

  return (
    orderData.internal_status === OrderInternalStatus.WAITING_CHANNEL_VALIDATION &&
    String((orderData as any).actual_situation) === "748743"
  );
}

const STATUSES_SCHEDULABLE_FOR_COLLECTION_DATE: readonly OrderInternalStatus[] = [
  OrderInternalStatus.OPEN,
  OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
  OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
];

/**
 * Ponto único de gravação/reconciliação de collection_date + agendamento de
 * emissão de NFe — extração de MLOrderSyncQueue (applyCollectionDateLocked/
 * scheduleNfe/finalizeNfeScheduling), generalizada para não assumir que quem
 * chama é a ML_ORDER_SYNC: usada também por BLING_ORDER_INGESTION,
 * MARKETPLACE_WEBHOOK_SYNC e a cadência de collection_date do
 * MARKETPLACE_RECONCILER.
 *
 * Fica ao lado de nfe.queue.ts/nfe-reconciler.queue.ts (não em
 * marketplace/) porque os efeitos colaterais (PATCH de situação Bling
 * 748748, addDelayed/removeJob no NFeQueue, setDelayBasedOnDate,
 * mapOrderInternalStatus) são maquinário de Bling/emissão de NFe — o método
 * só *consome* uma collection_date já resolvida, seja qual for a origem.
 */
export class CollectionDateSchedulerService {
  constructor(
    private blingApi: AxiosInstance,
    private nfeNext: nextStepDelayedOnQueue & nextRemoveOnQueue & getJob,
  ) {}

  // Ponto de entrada público — pega o withOrderLock sozinho. Usado por quem
  // ainda não está dentro do lock do pedido.
  async syncCollectionDate(
    idOrderSystem: string,
    newDate: Date,
    orderSystem: FullOrder,
  ): Promise<void> {
    return withOrderLock("CollectionDateScheduler", idOrderSystem, () =>
      this.syncCollectionDateLocked(idOrderSystem, newDate, orderSystem),
    );
  }

  // Assume que quem chama já está dentro do withOrderLock do pedido — usado
  // por BLING_ORDER_INGESTION (já travado em BlingOrderQueue.process, status
  // OPEN — ver nota de segurança em scheduleNfe abaixo), ML_ORDER_SYNC (já
  // travado em syncFromWebhookLocked), MARKETPLACE_WEBHOOK_SYNC e a
  // cadência de collection_date do MARKETPLACE_RECONCILER (ambos travam a
  // si mesmos em volta desta chamada + a escrita de label status).
  //
  // Comparação por DIA, não por instante exato (pedido explícito do
  // usuário): o horário de fato é decidido depois por setDelayBasedOnDate
  // (a janela 6h–13h BRT), não pelo horário bruto que a API do marketplace
  // ou dataPrevista da Bling devolvem — duas chamadas para o mesmo dia
  // civil, com horários de resposta diferentes, não podem contar como uma
  // mudança real. A normalização pra início do dia BRT acontece aqui
  // (única, central), não em cada call site.
  //
  // IMPORTANTE: "mesmo dia" só pode virar no-op total quando JÁ existe um
  // job de emissão agendado (WAITING_FOR_NFE_EMISSION) — nesse caso, nada
  // muda de fato, então pular remove/recria do job é o comportamento certo.
  // Para OPEN/WAITING_CHANNEL_VALIDATION (nenhum job ainda), o dia não ter
  // mudado NÃO significa "nada a fazer" — pode ser a primeira vez que esse
  // pedido está sendo processado com esse valor (ex: BLING_ORDER_INGESTION
  // gravou dataPrevista, e agora ML_ORDER_SYNC confirma o mesmo dia via
  // marketplace) e o agendamento em si ainda não aconteceu. Por isso o
  // branch OPEN/WAITING_CHANNEL_VALIDATION sempre chama scheduleNfe,
  // independente de ter mudado ou não — scheduleNfe/finalizeNfeScheduling
  // já são seguros de chamar de novo (removeJob antes de addDelayed), e
  // isEligibleForSync dentro de scheduleNfe garante que nada acontece de
  // fato enquanto o pedido ainda não estiver em WAITING_CHANNEL_VALIDATION.
  async syncCollectionDateLocked(
    idOrderSystem: string,
    newDate: Date,
    orderSystem: FullOrder,
  ): Promise<void> {
    const normalizedNewDate = startOfDayTz(newDate).toDate();
    const existingDay = orderSystem.collection_date
      ? startOfDayTz(orderSystem.collection_date).format("YYYY-MM-DD")
      : null;
    const newDay = startOfDayTz(normalizedNewDate).format("YYYY-MM-DD");
    const dateChanged = existingDay !== newDay;

    const status = orderSystem.internal_status;
    if (!status || !STATUSES_SCHEDULABLE_FOR_COLLECTION_DATE.includes(status)) {
      return; // no-op: já emitido/terminal
    }

    if (status === OrderInternalStatus.WAITING_FOR_NFE_EMISSION) {
      if (!dateChanged) return; // já agendado com esse mesmo dia — nada a fazer

      await ordersService.update(orderSystem.id, { collection_date: normalizedNewDate });

      // Mudou depois de já agendado — remove o job atual e recria com a
      // nova data (ou emite na hora se cair na janela de hoje 6h–13h, que
      // setDelayBasedOnDate já calcula sozinho).
      await this.nfeNext.removeJob(`nfe-generation-${idOrderSystem}`);
      return this.finalizeNfeScheduling(idOrderSystem, normalizedNewDate, {
        ...orderSystem,
        collection_date: normalizedNewDate,
      });
    }

    // OPEN / WAITING_CHANNEL_VALIDATION: só grava se o dia realmente mudou
    // (evita um update de banco redundante), mas SEMPRE tenta agendar — ver
    // nota "IMPORTANTE" acima sobre por que não dá pra tratar "dia igual"
    // como "nada a fazer" neste branch.
    if (dateChanged) {
      await ordersService.update(orderSystem.id, { collection_date: normalizedNewDate });
    }

    return this.scheduleNfe(idOrderSystem, normalizedNewDate, {
      ...orderSystem,
      collection_date: normalizedNewDate,
    });
  }

  /**
   * Remove job anterior (se existir) e cria novo job delayed na NFeQueue,
   * agendado pra dentro da janela 6h-13h BRT (via setDelayBasedOnDate,
   * dentro de finalizeNfeScheduling), ou trava o pedido pra aceite manual
   * se `lock_today_orders` estiver ativo e a coleta for hoje/futuro num
   * pedido criado hoje.
   *
   * NOTA DE SEGURANÇA: syncCollectionDateLocked chama este método também
   * quando orderSystem.internal_status é OPEN — é exatamente o caso de
   * BLING_ORDER_INGESTION gravando dataPrevista ANTES de CNPJ_VERIFY_CNAE
   * sequer rodar. Isso é seguro porque isEligibleForSync, logo abaixo,
   * rebusca o pedido no banco e exige especificamente internal_status ===
   * WAITING_CHANNEL_VALIDATION + situação Bling 748743 — com o pedido
   * ainda OPEN, essa checagem devolve false e o método retorna aqui mesmo,
   * sem PATCH na Bling, sem addDelayed, sem avançar o pedido. Ou seja:
   * chamar scheduleNfe a partir de BLING_ORDER_INGESTION só tem o efeito de
   * permitir a gravação de collection_date (já feita antes deste ponto, no
   * corpo de syncCollectionDateLocked) — nunca o de agendar/emitir uma NFe
   * prematuramente, antes da verificação de CNPJ/CNAE ter rodado.
   *
   * Assume que já está rodando dentro do withOrderLock do pedido — não pega
   * o lock de novo aqui (não é reentrante).
   */
  private async scheduleNfe(
    idOrderSystem: string,
    collectionDate: Date,
    orderSystem: any,
  ): Promise<void> {
    const jobId = `nfe-generation-${idOrderSystem}`;

    const integration = await integrationsService.getFullIntegration({
      where: { name: "Bling" },
    });

    if (COMPLETED_ORDER_INTERNAL_STATUSES.includes(orderSystem.internal_status)) {
      console.log(
        `[CollectionDateScheduler] Pedido ${orderSystem.number_order_channel} já com processo completo (${orderSystem.internal_status}). Ignorando.`,
      );
      return;
    }

    const isEligible = await isEligibleForSync(orderSystem.id);
    if (!isEligible) {
      console.log(
        `[CollectionDateScheduler] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION (internal_status/situacao.id divergente) — não agenda NFe.`,
      );
      return;
    }

    // CORREÇÃO DE TIMEZONE — o código original (mercado-livre-sync.queue.ts,
    // pré-extração) calculava "início de hoje" via Date.UTC(...) puro. É a
    // MESMA CLASSE de bug documentada no CLAUDE.md como incidente real de
    // produção (collection_date gravado em meia-noite UTC em vez de BRT, 3h
    // de offset silencioso). Ao mover essa lógica pra um serviço
    // compartilhado, agora alimentado por uma TERCEIRA fonte de data (a API
    // do marketplace, além de dataPrevista da Bling e do antigo scraping),
    // é exatamente o tipo de ponto de consolidação onde um descompasso
    // UTC/BRT pode reaparecer sem aviso — por isso essa fronteira é
    // endurecida proativamente na extração, usando nowTz()/startOfDayTz().
    const startOfTodayBrt = startOfDayTz(nowTz()).toDate().getTime();
    const createdToday = new Date(orderSystem.createdAt).getTime() >= startOfTodayBrt;
    const collectionIsTodayOrFuture = new Date(collectionDate).getTime() >= startOfTodayBrt;

    if (createdToday && collectionIsTodayOrFuture) {
      const alreadyScheduled = await this.nfeNext.getJob(jobId);

      if (integration.lock_today_orders) {
        if (!alreadyScheduled) {
          console.log(
            `[CollectionDateScheduler] Coleta HOJE e sem job agendado — travando pedido ${idOrderSystem} (waiting_acceptance)`,
          );

          await ordersService.update(orderSystem.id, {
            internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
            waiting_acceptance: true,
          });
          return;
        }

        if (orderSystem?.waiting_acceptance) {
          console.log(
            `[CollectionDateScheduler] Coleta HOJE mas waiting_acceptance ainda true — aguardando liberação manual para pedido ${idOrderSystem}`,
          );
          return;
        }
      }
    }

    await this.finalizeNfeScheduling(idOrderSystem, collectionDate, orderSystem);
  }

  /**
   * PATCH da situação Bling pra 748748 + grava WAITING_FOR_NFE_EMISSION +
   * agenda o job delayed na NFeQueue. Chamada só depois que scheduleNfe (ou
   * resumeAfterAcceptance, em MLOrderSyncQueue) já validou o pedido pelo
   * snapshot local — não confia só nisso: reconfere a situação ao vivo na
   * Bling antes do PATCH, porque isEligibleForSync lê actual_situation
   * (última gravação local), que ainda pode estar desatualizada em relação
   * à Bling — principalmente pra resumeAfterAcceptance, onde pode ter passado
   * bastante tempo entre o pedido ser travado (waiting_acceptance) e
   * alguém liberar manualmente. Assume que já está dentro do withOrderLock
   * do pedido, igual scheduleNfe.
   */
  async finalizeNfeScheduling(
    idOrderSystem: string,
    collectionDate: Date,
    orderSystem: any,
  ): Promise<void> {
    const { data } = await blingGet(`/pedidos/vendas/${idOrderSystem}`, this.blingApi);
    const currentSituacaoId = data?.data?.situacao?.id;
    const mappedStatus = mapOrderInternalStatus(currentSituacaoId);

    if (mappedStatus !== OrderInternalStatus.WAITING_CHANNEL_VALIDATION) {
      console.log(
        `[CollectionDateScheduler] Pedido ${orderSystem.number_order_channel} não está mais em WAITING CHANNEL VALIDATION na Bling (situação atual ${currentSituacaoId} -> ${mappedStatus}) — sincronizando sem agendar NFe.`,
      );
      await ordersService.update(orderSystem.id, {
        internal_status: mappedStatus,
        ...(COMPLETED_ORDER_INTERNAL_STATUSES.includes(mappedStatus)
          ? { nfe_emitted: true }
          : mappedStatus === OrderInternalStatus.CANCELLED
            ? { nfe_emitted: false }
            : {}),
      });
      return;
    }

    const jobId = `nfe-generation-${idOrderSystem}`;

    await this.nfeNext.removeJob(jobId);

    const MIN_DELAY_MS = 30_000;

    const delay = Math.max(setDelayBasedOnDate(new Date(collectionDate)), MIN_DELAY_MS);

    await blingPatch(
      `/pedidos/vendas/${idOrderSystem}/situacoes/748748`,
      { id: 748748 },
      this.blingApi,
    );

    await ordersService.update(orderSystem.id, {
      internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
    });

    await this.nfeNext.addDelayed(
      {
        order_id: idOrderSystem,
        collection_date: String(collectionDate),
        orderSystem,
      },
      jobId,
      delay,
    );
  }
}
