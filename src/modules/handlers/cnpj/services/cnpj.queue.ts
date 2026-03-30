import { CNPJService } from "./cnpj.service";
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from "bullmq";
import { AxiosInstance } from 'axios';

const ErrorValues = [
    {
        id: 1,
        error: 'Documento não informado ou inválido '
    },
    {
        id: 2,
        error: 'CNAE não atendido pela empresa'
    },
   
]

export class CNPJQueue extends BaseQueueService<any> {
  private CNPJService;
  private blingApi;

  constructor(cnpjService: CNPJService, blingApi: AxiosInstance) {
    super("CNPJ_VERIFY_CNAE");
    this.CNPJService = cnpjService;
    this.blingApi = blingApi;
  }

    private async markOrderError(order: any, errorId: number): Promise<void> {
        const errorMessage = ErrorValues.find(e => e.id === errorId)?.error

        // // Atualiza a observação
        // await this.blingApi.put(`/pedidos/vendas/${order.id}`, {
        //     observacoesInternas: `${order.observacoesInternas ?? ''}\nPedido Cancelado pelo Motivo: ${errorMessage}`.trim()
        // })

        // // Muda o status para Cancelado (ID 12)
        // await this.blingApi.patch(`/pedidos/vendas/${order.id}/situacoes/12`)
        console.log(`[CNPJQueue] Pedido ${order.id} marcado com erro: ${errorMessage}`)

        console.log(`[CNPJQueue] Pedido ${order.id} marcado com erro: ${errorMessage}`);
    }

   async process(job: Job<any, any, string>): Promise<void> {
        console.log(`[QUEUE] Processando verificação de documento ${job.id}`)

        const { customer, cnaes, order } = job.data
        const document = Number(customer.document)

        // Documento inválido
        if (!customer.document || isNaN(document)) {
            console.log(`[CNPJQueue] Documento inválido ou não informado`)
            await this.markOrderError(order, 1)
            return
        }

        // CPF — pula validação de CNAE
        if (customer.type === 'F') {
            console.log(`[CNPJQueue] CPF, seguindo para próxima fila: Verificar data de coleta`)

            this.emit('cnpj.approved', {order, customer})
        
            return
        }

        // CNPJ — valida CNAE
        const cnaeApproved = await this.CNPJService.checkCNAE(cnaes, document)

        if (cnaeApproved) {
            console.log(`[CNPJQueue] CNAE aprovado, seguindo para próxima fila: Verificar data de coleta`)
            
            this.emit('cnpj.approved', {order, customer})
        } else {
            console.log(`[CNPJQueue] CNAE não atendido`)
            await this.markOrderError(order, 2)
        }
    }
}
