import { CNPJService } from "./cnpj.service";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from "bullmq";
import { AxiosInstance } from "axios";
import { nextStepOnQueue } from "../../../../shared/types/queue/base-queue";
import ordersService from "../../../sales/orders/order/orders.service";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

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
    super("CNPJ_VERIFY_CNAE", {
      limiter: {
        max: 1,
        duration: 3000
      }
    });
    this.CNPJService = cnpjService;
    this.blingApi = blingApi;
    this.next = next;
  }

  private async markOrderError(order: any, errorId: number): Promise<void> {
    const errorMessage = ErrorValues.find((e) => e.id === errorId)?.error;
    const { data } = await this.blingApi.get(`/pedidos/vendas/${order.id_order_system}`)
    // // Atualiza a observação
    await this.blingApi.put(`/pedidos/vendas/${order.id_order_system}`, {
        ...data.data,
        observacoesInternas: `${data.data.observacoesInternas} \n Pedido Cancelado pelo Motivo: ${errorMessage}`.trim()
    })

    // // Muda o status para Cancelado (ID 12)
    await this.blingApi.patch(`/pedidos/vendas/${order.id_order_system}/situacoes/12`, {
      id: 12
    })

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

    const { customer, cnaes, orderSystem } = job.data;
    const document = Number(customer.document);

    try {
      // Documento inválido
      if (!customer.document || isNaN(document)) {
        console.log(`[CNPJQueue] Documento inválido ou não informado`);
        await this.markOrderError(orderSystem, 1);
        return;
      }

      // CPF — pula validação de CNAE
      if (customer.type === "F") {
        console.log(
          `[CNPJQueue] CPF, seguindo para próxima fila: Verificar data de coleta`,
        );

        // Atualiza para aguardando agendamento de nfe
        const blingAnswer = await this.blingApi.patch(`/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748743`, {
          id: 748743
        })

        await ordersService.update(orderSystem.id, {
      // ← precisa ser o id do banco, não o id da Bling
      internal_status: "WAITING FOR NFE EMISSION",
      });
        //@ts-ignore
        console.log('error bling cpf', blingAnswer?.response?.data)

        await this.next.add(
          { orderSystem, customer },
          `ml-check-${orderSystem.id}`,
        );

        return;
      }

      // CNPJ — valida CNAE
      const cnaeApproved = await this.CNPJService.checkCNAE(cnaes, document);

      if (!cnaeApproved) {
        console.log(
          `[CNPJQueue] CNAE aprovado, seguindo para próxima fila: Verificar data de coleta`,
        );

        // Atualiza para em aguardando agendamento de nfe
        const apllybling = await this.blingApi.patch(`/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748743`)
        
        await ordersService.update(orderSystem.id, {
      // ← precisa ser o id do banco, não o id da Bling
      internal_status: "WAITING FOR NFE EMISSION",
      });
      
      //@ts-ignore
        console.log("CANE APROVADO", apllybling.response.data)
        await this.next.add(
          { orderSystem, customer },
          `ml-check-${orderSystem.id}`,
        );
      } else {
        console.log(`[CNPJQueue] CNAE não atendido`);
        await this.markOrderError(orderSystem, 2);
      }
    } catch (error: any) {
      console.log('Erro do cnpj', error)
      alertService.sendAlert({
        severity: "HIGH",
        title: "CNPJ API — todos os providers falharam",
        message: `Pedido ${orderSystem?.id_order_system} travado na verificação de CNAE. Erro: ${error.message}`,
      });
      throw error;
    }
  }
}
