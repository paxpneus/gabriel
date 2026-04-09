import { CNPJService } from "./cnpj.service";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import ordersService from "../../../sales/orders/order/orders.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

const ErrorValues = [
  { id: 1, error: "Documento não informado ou inválido " },
  { id: 2, error: "CNAE não atendido pela empresa" },
];

export class CNPJQueue extends BaseQueueService<any> {
  private CNPJService;
  private blingApi;
  private next: nextStepOnQueue;

  constructor(
    cnpjService: CNPJService,
    blingApi: AxiosInstance,
    next: nextStepOnQueue,
    options: { workless?: boolean } = {},
  ) {
    super("CNPJ_VERIFY_CNAE", {
      concurrency: 1,
      limiter: { max: 1, duration: 3000 },
      workless: options.workless,
    });
    this.CNPJService = cnpjService;
    this.blingApi = blingApi;
    this.next = next;
  }

  private async markOrderError(order: any, errorId: number): Promise<void> {
    const errorMessage = ErrorValues.find((e) => e.id === errorId)?.error;
    const { data } = await this.blingApi.get(`/pedidos/vendas/${order.id_order_system}`);

    await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
      ...data.data,
      observacoesInternas:
        `${data.data.observacoesInternas} \n Pedido Cancelado pelo Motivo: ${errorMessage}`.trim(),
    });

    await this.blingApi.patch(
      `/pedidos/vendas/${order.id_order_system}/situacoes/748772`,
      { id: 748772 },
    );

    await ordersService.update(order.id, { internal_status: "CANCELLED" });
    console.log(`[CNPJQueue] Pedido ${order.id} marcado com erro: ${errorMessage}`);
  }

  /**
   * Aplica o status "Aguardando NFe" (748743) na Bling.
   * Retorna false se a transição não for permitida (400) sem lançar —
   * a Bling rejeita 400 quando o pedido já está num status que não permite
   * essa transição. O fluxo da fila não deve ser bloqueado por isso.
   */
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
      throw err; // 401, 5xx, rede → BullMQ retry
    }
  }

  async process(job: Job<any, any, string>): Promise<void> {
    console.log(`[QUEUE] Processando verificação de documento ${job.id}`);

    const { customer, cnaes, orderSystem } = job.data;
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
      await ordersService.update(orderSystem.id, { internal_status: "WAITING CHANNEL VALIDATION" });
      await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);
      return;
    }

    // 3. CNPJ — valida CNAE
    try {
      const cnaeApproved = await this.CNPJService.checkCNAE(cnaes, document);

      if (!cnaeApproved) {
        // CNAE não está na lista de bloqueados → empresa pode atender, segue
        console.log(`[CNPJQueue] CNAE liberado para pedido ${orderSystem.id_order_system} — seguindo para data de coleta`);
        await this.applyWaitingNfeStatus(orderSystem);
        await ordersService.update(orderSystem.id, { internal_status: "WAITING CHANNEL VALIDATION" });
        await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);
      } else {
        // CNAE está na lista de bloqueados → empresa não pode atender, cancela
        console.log(`[CNPJQueue] CNAE bloqueado para pedido ${orderSystem.id_order_system} — cancelando`);
        await this.markOrderError(orderSystem, 2);
      }
    } catch (error: any) {
      console.error(
        `[CNPJQueue] Falha ao processar pedido ${orderSystem?.id_order_system}:`,
        error.message,
      );

      // Só dispara alerta de "providers falharam" se for realmente falha da API de CNPJ
      if (error.message?.includes("[CNPJ]")) {
        alertService.sendAlert({
          severity: "HIGH",
          title: "CNPJ API — todos os providers falharam",
          message: `Pedido ${orderSystem?.id_order_system} travado na verificação de CNAE. Erro: ${error.message}`,
        });
      }

      throw error; // BullMQ retry com backoff exponencial
    }
  }
}