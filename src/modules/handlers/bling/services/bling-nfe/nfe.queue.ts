import { includes } from "zod";
import { StoreService } from "./../../../../sales/stores/stores.service";
// src/.../nfe/nfe.queue.ts

import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import { NFeValidationService } from "./nfe-validation.service";
import { NFeJobData } from "./nfe.types";
import { AxiosInstance } from "axios";
import ordersService from "../../../../sales/orders/order/orders.service";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { BLING_SHARED_QUEUE_LOCK } from "../bling/queues/bling-queue-lock";
import { blingGet } from "../bling/helpers/get-with-sleep";
import { mapOrderInternalStatus } from "../../../../../shared/utils/normalizers/bling/status-mapper";
import {
  COMPLETED_ORDER_INTERNAL_STATUSES,
  CompletedOrderInternalStatus,
  OrderInternalStatus,
} from "../../../../sales/orders/order/orders.types";
import { syncOrderInternalStatus } from "../../../../sales/orders/order/helpers/order-status";

const ALLOWED_STORE_NAME = "MercadoLivre";

const STATUS = {
  NFE_AGENDADA: 748748,
  CANCELADO: 12,
  AGUARDANDO_VERIFICACAO_HUMANA: 748772,
};

const NFE_ERRORS = {
  WRONG_STATUS: {
    id: 4,
    message: "Pedido não estava no status NFE Agendada ao tentar gerar NFe",
  },
  MISSING_FIELDS: {
    id: 5,
    message: "Campos obrigatórios ausentes para geração de NFe",
  },
  EMISSION_FAILED: { id: 6, message: "Falha ao gerar NFe na Bling" },
};

export class NFeQueue extends BaseQueueService<NFeJobData> {
  private blingApi: AxiosInstance;
  private validationService: NFeValidationService;
  private storeService: StoreService;

  constructor(
    validationService: NFeValidationService,
    blingApi: AxiosInstance,
    options: { workless?: boolean } = {},
  ) {
    super("NFE_EMISSION", {
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 3000,
      },
      maxProcessingMs: 60_000,

      sharedLock: BLING_SHARED_QUEUE_LOCK,
      workless: options.workless,
    });
    this.blingApi = blingApi;
    this.validationService = validationService;
    this.storeService = new StoreService();
  }

  private async isMercadoLivreOrder(order: any): Promise<boolean> {
    const storeSystemId = order.loja?.id;
    if (!storeSystemId) return false;

    const store = await this.storeService.findOne({
      where: { id_store_system: String(storeSystemId) },
    });

    return store?.name === ALLOWED_STORE_NAME;
  }

  private async markOrderCancelled(
    orderId: number,
    message: string,
  ): Promise<void> {
    const { data } = await blingGet(
      `/pedidos/vendas/${orderId}`,
      this.blingApi,
    );

    await new Promise((r) => setTimeout(r, 1000));

    await this.blingApi.put(`/pedidos/vendas/${orderId}`, {
      ...data.data,
      observacoesInternas: `${data.data.observacoesInternas} \n Pedido marcado como Aguardando verificação humana na geração de nota fiscal: ${message}`,
    });

    await new Promise((r) => setTimeout(r, 3000));

    await this.blingApi.patch(
      `/pedidos/vendas/${orderId}/situacoes/${STATUS.AGUARDANDO_VERIFICACAO_HUMANA}`,
      {
        id: STATUS.AGUARDANDO_VERIFICACAO_HUMANA,
      },
    );
    const orderSystem = await ordersService.findOne({
      where: {
        id_order_system: orderId,
      },
    });
    if (!orderSystem) return;
    await ordersService.update(orderSystem.id, {
      internal_status: OrderInternalStatus.CANCELLED,
    });
    console.log(
      `[NFeQueue] Pedido ${orderId} Marcado como Aguardando verificação humana: ${message}`,
    );
  }

  async process(job: Job<NFeJobData>): Promise<void> {
    const { order_id } = job.data;

    console.log(`[NFeQueue] Processando NFe do pedido ${order_id}`);

    // 1. Busca o pedido fresco na Bling
    const { data } = await this.blingApi.get(`/pedidos/vendas/${order_id}`);
    const order = data.data;

    // 1.1 Filtra por loja — só Mercado Livre passa daqui pra frente
    const isML = await this.isMercadoLivreOrder(order);
    if (!isML) {
      console.log(
        `[NFeQueue] Pedido ${order_id} não é da loja Mercado Livre (loja=${order.loja?.nome ?? order.loja?.id ?? "desconhecida"}). Ignorando — sem update na Bling, sem update no sistema.`,
      );
      return;
    }

    // 2. Verifica se ainda está em nfe agendada (status 748748)
    if (order.situacao?.id !== STATUS.NFE_AGENDADA) {
      const syncResult = await syncOrderInternalStatus(
        order.situacao?.id,
        order_id,
      );

      if (syncResult.handled) {
        console.log(
          `[NFeQueue] Pedido ${order_id} sincronizado (outcome=${syncResult.outcome}, status=${syncResult.internalStatus}).`,
        );
        return;
      }

      await this.markOrderCancelled(order_id, NFE_ERRORS.WRONG_STATUS.message);
      return;
    }

    // 3. Valida campos obrigatórios
    const validation = this.validationService.validate(order);

    if (!validation.valid) {
      const detail = validation.missingFields.join(", ");
      console.error(`[NFeQueue] Campos ausentes: ${detail}`);
      await this.markOrderCancelled(
        order_id,
        `${NFE_ERRORS.MISSING_FIELDS.message}: ${detail}`,
      );
      return;
    }

    // 4. Emite a NFe
    try {
      await this.blingApi.post(`/pedidos/vendas/${order_id}/gerar-nfe`);
      console.log(`[NFeQueue] NFe emitida com sucesso para pedido ${order_id}`);

      const internalOrder = await ordersService.findOne({
        where: { id_order_system: String(order.id) },
      });

      if (!internalOrder) {
        console.warn(
          `[NFeQueue] Pedido ${order_id} não encontrado no banco. Pulando update.`,
        );
        return;
      }

      await ordersService.update(internalOrder.id, {
        nfe_emitted: true,
        internal_status: OrderInternalStatus.EMITTED,
      });
    } catch (error: any) {
      const fields = error.response?.data?.error?.fields ?? [];
      const noStock = fields.some((f: any) => f.code === 74);

      console.error(
        `[NFeQueue] Erro ao emitir NFe para pedido ${order_id}:`,
        JSON.stringify(error.response?.data) ?? error.message,
      );

      if (noStock) {
        await this.markOrderCancelled(
          order_id,
          "Item(s) sem estoque disponível na Bling. Requer reposição manual.",
        );
        alertService.sendAlert({
          severity: "HIGH",
          title: "NFe — Sem estoque",
          message: `Pedido ${order_id} não pode emitir NFe: item sem estoque disponível na Bling. Requer reposição manual.`,
        });

        return;
      }

      throw error;
    }
  }

  protected onFailed(job: Job<NFeJobData>, error: Error): void {
    const { order_id } = job.data;

    if (error.message?.includes("Timeout aguardando lock compartilhado")) {
      console.warn(
        `[NFeQueue] Job ${job.id} (pedido ${order_id}) falhou por timeout de lock (>24h), não por erro de emissão. Pedido NÃO foi cancelado.`,
      );
      return;
    }

    this.markOrderCancelled(order_id, NFE_ERRORS.EMISSION_FAILED.message);
    alertService.sendAlert({
      severity: "CRITICAL",
      title: "NFe — falha após todos os retries",
      message: `Pedido ${job.data.order_id} não teve NFe emitida. Requer intervenção manual. Erro: ${error.message}`,
    });
  }
}
