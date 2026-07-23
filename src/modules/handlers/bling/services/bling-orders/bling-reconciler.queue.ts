import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import { AxiosInstance } from "axios";
import BlingOrderService from "../bling-orders/bling-order.service";
import { getBlingIntegration } from "../../api/bling_api.service";
import ordersService from "../../../../sales/orders/order/orders.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BLING_SHARED_QUEUE_LOCK } from "../bling/queues/bling-queue-lock";
import { blingGet } from "../bling/helpers/get-with-sleep";

const BLING_SITUACAO_ATENDIDO = 9;

const BLING_SITUACAO_AGUARDANDO_NF_COM_COLETA = 748748;

type ReconcilerTask = "reconcile-open-orders" | "sync-invoiced-or-collected";

export class BlingReconcilerQueue extends BaseQueueService<
  Record<string, never>
> {
  private blingApi: AxiosInstance;
  private blingOrderNext: { add: (data: any, jobId: string) => Promise<any> };
  private blingOrderService: BlingOrderService;

  constructor(
    blingApi: AxiosInstance,
    blingOrderNext: { add: (data: any, jobId: string) => Promise<any> },
    options: { workless?: boolean } = {}
  ) {
    super("BLING_RECONCILER", {
      concurrency: 1,
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.blingOrderNext = blingOrderNext;
    this.blingOrderService = new BlingOrderService(blingApi);
  }

  // ─── Dispatcher: decide qual rotina rodar com base nos dados do job ─────────
  // Job sem "task" (ou task desconhecida) cai no comportamento original,
  // pra não quebrar nenhuma chamada existente (ex: scheduleOpenOrders()).
  async process(job: Job): Promise<void> {
    const task: ReconcilerTask = job?.data?.task ?? "reconcile-open-orders";

    if (task === "sync-invoiced-or-collected") {
      return this.syncInvoicedOrCollectedOrders();
    }

    return this.reconcileOpenOrders();
  }

  // ─── Busca o canal MercadoLivre e retorna o STORE_ID ────────────────────────
  private async getMercadoLivreStoreId(): Promise<number | undefined> {
    const channelResponse = await this.blingApi.get(`/canais-venda`, {
      params: { tipos: ["MercadoLivre"], situacao: 1 },
    });
    return channelResponse.data.data?.[0]?.id;
  }

  // ─── Rotina original (default, roda a cada 2h): cria no banco pedidos que já
  // existem na Bling em situação 6 mas ainda não foram sincronizados ──────────
  private async reconcileOpenOrders(): Promise<void> {
    console.log("[BlingReconciler] Verificando pedidos abertos na Bling...");

    const integration = await getBlingIntegration("Bling");
    if (!integration) {
      console.warn("[BlingReconciler] Integration não encontrada. Pulando.");
      return;
    }

    const STORE_ID = await this.getMercadoLivreStoreId();
    if (!STORE_ID) {
      console.warn("[BlingReconciler] Canal MercadoLivre não encontrado.");
      return;
    }

    const dataInicial = new Date();
    dataInicial.setDate(dataInicial.getDate() - 7);
    const dataInicialStr = dataInicial.toISOString().split("T")[0];

    const PAGE_LIMIT = 100;
    let page = 1;
    let totalFound = 0;
    let created = 0;
    let failedCount = 0;

    while (true) {
      const { data } = await this.blingApi.get(`/pedidos/vendas`, {
        params: {
          idLoja: STORE_ID,
          "idsSituacoes[]": 6,
          dataInicial: dataInicialStr,
          pagina: page,
          limite: PAGE_LIMIT,
        },
      });

      const orders: any[] = data.data ?? [];
      console.log(
        `[BlingReconciler] Página ${page}: ${orders.length} pedido(s) desde ${dataInicialStr}`,
      );
      if (orders.length === 0) break;
      totalFound += orders.length;

      const numbers = orders.map((o: any) => String(o.numero));

      const existingOrders = await ordersService.findAll({
        where: {
          integrations_id: integration.id,
          number_order_system: numbers,
        },
      });

      const existingNumbers = new Set(
        existingOrders.map((o) => o.number_order_system),
      );

      for (const blingOrder of orders) {
        if (existingNumbers.has(String(blingOrder.numero))) continue;

        console.log(
          `[BlingReconciler] Pedido ${blingOrder.numero} não encontrado. Criando...`,
        );

        try {
          await this.blingOrderNext.add(
            {
              event: "order.created",
              action: "created",
              data: {
                id: blingOrder.id,
                numero: blingOrder.numero,
                situacao: blingOrder.situacao,
              },
            },
            `bling-order-created-${blingOrder.id}`,
          );
          created++;
        } catch (err: any) {
          failedCount++;
          console.error(
            `[BlingReconciler] Erro ao criar pedido ${blingOrder.numero}:`,
            err.response?.data ?? err.message,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      if (orders.length < PAGE_LIMIT) break;
      page++;
    }

    if (failedCount > 0) {
      alertService.sendAlert({
        severity: "HIGH",
        title: "BlingReconciler — pedidos não sincronizados",
        message: `${failedCount} pedido(s) falharam durante a sincronização. Verificar logs do BlingReconciler.`,
      });
    }

    console.log(
      `[BlingReconciler] Concluído. ${totalFound} verificado(s), ${created} criado(s).`,
    );
  }

  // ─── Nova rotina (roda a cada 30min): pedidos em situação 6 na Bling que já
  // existem no nosso banco e que já deveriam ter avançado de status:
  //   - se já tem NF vinculada na Bling  -> muda situação pra Atendido (9)
  //   - se não tem NF mas já tem collection_date no banco -> muda situação
  //     pra "aguardando NF com coleta" (BLING_SITUACAO_AGUARDANDO_NF_COM_COLETA)
  // ─────────────────────────────────────────────────────────────────────────
  private async syncInvoicedOrCollectedOrders(): Promise<void> {
    console.log(
      "[BlingReconciler] Verificando pedidos em situação 6 com NF ou coleta já registrada...",
    );

    const integration = await getBlingIntegration("Bling");
    if (!integration) {
      console.warn("[BlingReconciler] Integration não encontrada. Pulando.");
      return;
    }

    const STORE_ID = await this.getMercadoLivreStoreId();
    if (!STORE_ID) {
      console.warn("[BlingReconciler] Canal MercadoLivre não encontrado.");
      return;
    }

    const dataInicial = new Date();
    dataInicial.setDate(dataInicial.getDate() - 7);
    const dataInicialStr = dataInicial.toISOString().split("T")[0];

    const PAGE_LIMIT = 100;
    let page = 1;
    let totalChecked = 0;
    let updatedToInvoiced = 0;
    let updatedToCollected = 0;
    let failedCount = 0;

    while (true) {
      const { data } = await this.blingApi.get(`/pedidos/vendas`, {
        params: {
          idLoja: STORE_ID,
          "idsSituacoes[]": 6,
          dataInicial: dataInicialStr,
          pagina: page,
          limite: PAGE_LIMIT,
        },
      });

      const orders: any[] = data.data ?? [];
      if (orders.length === 0) break;

      const numbers = orders.map((o: any) => String(o.numero));

      const existingOrders = await ordersService.findAll({
        where: {
          integrations_id: integration.id,
          number_order_system: numbers,
        },
      });

      const existingByNumber = new Map(
        existingOrders.map((o) => [o.number_order_system, o]),
      );

      for (const blingOrder of orders) {
        const existingOrder = existingByNumber.get(String(blingOrder.numero));
        if (!existingOrder) continue; // só nos interessa pedido que já existe no banco

        totalChecked++;

        try {
          // A listagem de /pedidos/vendas não traz notaFiscal de forma confiável,
          // então busca o pedido completo (mesmo endpoint usado no create/update).
          const { data: fullOrderResponse } = await blingGet(
            `/pedidos/vendas/${blingOrder.id}`,
            this.blingApi,
          );
          const orderData = fullOrderResponse.data;

          const hasInvoice = !!orderData.notaFiscal?.id;
          const hasCollectionDate = !!existingOrder.collection_date;

          if (hasInvoice) {
            await this.blingApi.patch(
              `/pedidos/vendas/${blingOrder.id}/situacoes/${BLING_SITUACAO_ATENDIDO}`,
              { id: BLING_SITUACAO_ATENDIDO },
            );
            updatedToInvoiced++;
            console.log(
              `[BlingReconciler] Pedido ${blingOrder.numero} já tem NF (${orderData.notaFiscal.id}) — situação alterada para Atendido (${BLING_SITUACAO_ATENDIDO}).`,
            );
          } else if (hasCollectionDate) {
            await this.blingApi.patch(
              `/pedidos/vendas/${blingOrder.id}/situacoes/${BLING_SITUACAO_AGUARDANDO_NF_COM_COLETA}`,
              { id: BLING_SITUACAO_AGUARDANDO_NF_COM_COLETA },
            );
            updatedToCollected++;
            console.log(
              `[BlingReconciler] Pedido ${blingOrder.numero} sem NF mas com coleta agendada — situação alterada para ${BLING_SITUACAO_AGUARDANDO_NF_COM_COLETA}.`,
            );
          }
          // Se não tem NF nem collection_date, não faz nada — segue em aberto normalmente.
        } catch (err: any) {
          failedCount++;
          console.error(
            `[BlingReconciler] Erro ao sincronizar situação do pedido ${blingOrder.numero}:`,
            err.response?.data ?? err.message,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      if (orders.length < PAGE_LIMIT) break;
      page++;
    }

    if (failedCount > 0) {
      alertService.sendAlert({
        severity: "MEDIUM",
        title: "BlingReconciler — falha ao sincronizar situação de pedidos",
        message: `${failedCount} pedido(s) falharam ao tentar sincronizar situação (NF/coleta). Verificar logs do BlingReconciler.`,
      });
    }

    console.log(
      `[BlingReconciler] Sincronização de situação concluída. ${totalChecked} verificado(s), ${updatedToInvoiced} -> Atendido, ${updatedToCollected} -> Aguardando NF com coleta.`,
    );
  }

  // Mantido por retrocompatibilidade — chama a rotina original diretamente
  // (sem passar pelo agendador/repeat).
  public scheduleOpenOrders() {
    this.process({ data: { task: "reconcile-open-orders" } } as Job);
  }
}

export default BlingReconcilerQueue;