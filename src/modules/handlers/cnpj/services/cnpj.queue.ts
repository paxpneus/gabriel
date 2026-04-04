import { CNPJService } from "./cnpj.service";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import ordersService from "../../../sales/orders/order/orders.service";

const ErrorValues = [
  {
    id: 1,
    error: "Documento não informado ou inválido ",
  },
  {
    id: 2,
    error: "CNAE não atendido pela empresa",
  },
];

export class CNPJQueue extends BaseQueueService<any> {
  private CNPJService;
  private blingApi;
  private next: nextStepOnQueue;

  constructor(
    cnpjService: CNPJService,
    blingApi: AxiosInstance,
    next: nextStepOnQueue,
  ) {
    super("CNPJ_VERIFY_CNAE");
    this.CNPJService = cnpjService;
    this.blingApi = blingApi;
    this.next = next;
  }

  private async markOrderError(order: any, errorId: number): Promise<void> {
    const errorMessage = ErrorValues.find((e) => e.id === errorId)?.error;

    // // Atualiza a observação
    // await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
    //     observacoesInternas: `${order.observacoesInternas ?? ''}\nPedido Cancelado pelo Motivo: ${errorMessage}`.trim()
    // })

    // // Muda o status para Cancelado (ID 12)
    // await this.blingApi.patch(`/pedidos/vendas/${order.id_order_system}/situacoes/12`)


    await ordersService.update(order.id, {
      // ← precisa ser o id do banco, não o id da Bling
      internal_status: "CANCELLED",
    });

    console.log(
      `[CNPJQueue] Pedido ${order.id} marcado com erro: ${errorMessage}`,
    );
  }

  async process(job: Job<any, any, string>): Promise<void> {
    console.log(`[QUEUE] Processando verificação de documento ${job.id}`);

    const { customer, cnaes, orderSystem, orderBling } = job.data;
    const document = Number(customer.document);

    // Documento inválido
    if (!customer.document || isNaN(document)) {
      console.log(`[CNPJQueue] Documento inválido ou não informado`);
      await this.markOrderError(orderBling, 1);
      return;
    }

    // CPF — pula validação de CNAE
    if (customer.type === "F") {
      console.log(
        `[CNPJQueue] CPF, seguindo para próxima fila: Verificar data de coleta`,
      );

      // Atualiza para em andamento
      // await this.blingApi.patch(`/pedidos/vendas/${order.id_order_system}/situacoes/15`)
      await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);

      return;
    }

    // CNPJ — valida CNAE
    const cnaeApproved = await this.CNPJService.checkCNAE(cnaes, document);

    if (cnaeApproved) {
      console.log(
        `[CNPJQueue] CNAE aprovado, seguindo para próxima fila: Verificar data de coleta`,
      );

      // Atualiza para em andamento
      // await this.blingApi.patch(`/pedidos/vendas/${orderId}/situacoes/15`)
      await this.next.add({ orderSystem, customer }, `ml-check-${orderSystem.id}`);
    } else {
      console.log(`[CNPJQueue] CNAE não atendido`);
      await this.markOrderError(orderBling, 2);
    }
  }
}
