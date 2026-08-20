import { CNPJService } from "./cnpj.service";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import ordersService from "../../../sales/orders/order/orders.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { BLING_SHARED_QUEUE_LOCK } from "../../bling/services/bling/queues/bling-queue-lock";
import { StoreService } from "../../../sales/stores/stores.service";
import { blingGet } from "../../bling/services/bling/helpers/get-with-sleep";
import { syncOrderInternalStatus } from "../../../sales/orders/order/helpers/order-status";
import { OrderInternalStatus } from "../../../sales/orders/order/orders.types";

const ALLOWED_STORE_NAME = "MercadoLivre";
const STATUS_EM_ABERTO = 6;

const ErrorValues = [
  { id: 1, error: "Documento não informado ou inválido " },
  { id: 2, error: "CNAE não atendido pela empresa" },
];

export class CNPJQueue extends BaseQueueService<any> {
  private CNPJService;
  private blingApi: AxiosInstance;
  private next: nextStepOnQueue;
  private storeService: StoreService;

  constructor(
    cnpjService: CNPJService,
    blingApi: AxiosInstance,
    next: nextStepOnQueue,
    options: { workless?: boolean } = {},
  ) {
    super("CNPJ_VERIFY_CNAE", {
      concurrency: 1,
      limiter: { max: 1, duration: 3000 },
      sharedLock: BLING_SHARED_QUEUE_LOCK,
      maxProcessingMs: 60_000,
      workless: options.workless,
    });
    this.CNPJService = cnpjService;
    this.blingApi = blingApi;
    this.next = next;
    this.storeService = new StoreService();
  }

  private async isMercadoLivreOrder(loja: any): Promise<boolean> {
    const storeSystemId = loja?.id;
    if (!storeSystemId) return false;

    const store = await this.storeService.findOne({
      where: { id_store_system: String(storeSystemId) },
    });

    return store?.name === ALLOWED_STORE_NAME;
  }

  private async markOrderError(order: any, errorId: number): Promise<void> {
    const errorMessage = ErrorValues.find((e) => e.id === errorId)?.error;
    const { data } = await blingGet(
      `/pedidos/vendas/${order.id_order_system}`,
      this.blingApi,
    );

    await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
      ...data.data,
      observacoesInternas:
        `${data.data.observacoesInternas} \n Pedido Cancelado pelo Motivo: ${errorMessage}`.trim(),
    });

    await this.blingApi.patch(
      `/pedidos/vendas/${order.id_order_system}/situacoes/748772`,
      { id: 748772 },
    );

    await syncOrderInternalStatus(748772, order.id_order_system);
    console.log(`[CNPJQueue] Pedido ${order.id} marcado com erro: ${errorMessage}`);
  }

  private async applyWaitingNfeStatus(orderSystem: any): Promise<boolean> {
    try {
      await this.blingApi.patch(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748743`,
        { id: 748743 },
      );
      return true;
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.warn(
          `[CNPJQueue] Bling rejeitou mudança de status (400) para pedido ${orderSystem.id_order_system}.`,
          `Detalhe:`, err.response?.data ?? err.message,
        );
        return false;
      }
      throw err;
    }
  }

  async process(job: Job<any, any, string>): Promise<void> {
    console.log(`[QUEUE] Processando verificação de documento ${job.id}`);

    const { customer, cnaes, orderSystem } = job.data;

    const { data } = await blingGet(
      `/pedidos/vendas/${orderSystem.id_order_system}`,
      this.blingApi,
    );
    const freshOrder = data.data;

    const isML = await this.isMercadoLivreOrder(freshOrder.loja);
    if (!isML) {
      console.log(
        `[CNPJQueue] Pedido ${orderSystem.id_order_system} não é da loja Mercado Livre (loja=${freshOrder.loja?.nome ?? freshOrder.loja?.id ?? "desconhecida"}). Ignorando — sem alteração na Bling, sem update no sistema.`,
      );
      return;
    }

    if (freshOrder.situacao?.id !== STATUS_EM_ABERTO) {
      console.log(
        `[CNPJQueue] Pedido ${orderSystem.id_order_system} não está mais em "Em Aberto" (situação atual=${freshOrder.situacao?.id}). Ignorando — fora do momento da automação.`,
      );
      return;
    }

    const document = String(customer.document);

    // 1. Documento inválido
    if (!customer.document) {
      console.log(`[CNPJQueue] Documento inválido ou não informado`);
      await this.markOrderError(orderSystem, 1);
      return;
    }

    // 2. CPF — pula validação de CNAE, vai direto para coleta
    if (customer.type === "F") {
      console.log(`[CNPJQueue] CPF detectado — seguindo para próxima fila (data de coleta)`);

      await this.applyWaitingNfeStatus(orderSystem);
      await ordersService.update(orderSystem.id, { internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION });
      await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);
      return;
    }

    // 3. CNPJ — valida CNAE
    try {
      const cnaeApproved = await this.CNPJService.checkCNAE(cnaes, document);

      if (!cnaeApproved) {
        console.log(`[CNPJQueue] CNAE liberado para pedido ${orderSystem.id_order_system} — seguindo para data de coleta`);
        await this.applyWaitingNfeStatus(orderSystem);
        await ordersService.update(orderSystem.id, { internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION });
        await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);
      } else {
        console.log(`[CNPJQueue] CNAE bloqueado para pedido ${orderSystem.id_order_system} — cancelando`);
        await this.markOrderError(orderSystem, 2);
      }
    } catch (error: any) {
      console.error(
        `[CNPJQueue] Falha ao processar pedido ${orderSystem?.id_order_system}:`,
        error.message,
      );

      if (error.message?.includes("[CNPJ]")) {
        alertService.sendAlert({
          severity: "HIGH",
          title: "CNPJ API — todos os providers falharam",
          message: `Pedido ${orderSystem?.id_order_system} travado na verificação de CNAE. Erro: ${error.message}`,
        });
      }

      throw error;
    }
  }
}