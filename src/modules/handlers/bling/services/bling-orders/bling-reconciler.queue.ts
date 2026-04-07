import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import { AxiosInstance } from "axios";
import BlingOrderService from "../bling-orders/bling-order.service";
import { getBlingIntegration } from "../../api/bling_api.service";
import ordersService from "../../../../sales/orders/order/orders.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";

export class BlingReconcilerQueue extends BaseQueueService<
  Record<string, never>
> {
  private blingApi: AxiosInstance;
  private blingOrderNext: { add: (data: any, jobId: string) => Promise<any> };
  private blingOrderService: BlingOrderService;

  constructor(
    blingApi: AxiosInstance,
    blingOrderNext: { add: (data: any, jobId: string) => Promise<any> },
  ) {
    super("BLING_RECONCILER", { concurrency: 1 });
    this.blingApi = blingApi;
    this.blingOrderNext = blingOrderNext;
    this.blingOrderService = new BlingOrderService(blingApi);
  }

  async process(job: Job): Promise<void> {
    console.log("[BlingReconciler] Verificando pedidos abertos na Bling...");

    const integration = await getBlingIntegration("Bling");
    if (!integration) {
      console.warn("[BlingReconciler] Integration não encontrada. Pulando.");
      return;
    }

    const channelResponse = await this.blingApi.get(`/canais-venda`, {
      params: { tipos: ["MercadoLivre"], situacao: 1 },
    });
    const STORE_ID: number | undefined = channelResponse.data.data?.[0]?.id;
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
          integration_id: integration.id,
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
          await this.blingOrderService.createOrderFromBling({
            data: { id: blingOrder.id },
          });
          created++;
        } catch (err: any) {
          failedCount++
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
}
