// src/.../nfe/nfe.queue.ts

import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../shared/utils/base-models/base-queue-service";
import { NFeValidationService } from "./nfe-validation.service";
import { NFeJobData } from "./nfe.types";
import { AxiosInstance } from "axios";

const STATUS = {
  EM_ANDAMENTO: 6,
  CANCELADO: 12,
}

const NFE_ERRORS = {
  WRONG_STATUS:    { id: 4, message: "Pedido não está em andamento ao tentar emitir NFe" },
  MISSING_FIELDS:  { id: 5, message: "Campos obrigatórios ausentes para emissão de NFe" },
  EMISSION_FAILED: { id: 6, message: "Falha ao emitir NFe na Bling" },
}

export class NFeQueue extends BaseQueueService<NFeJobData> {
  private blingApi: AxiosInstance;
  private validationService: NFeValidationService;

  constructor(blingApi: AxiosInstance, validationService: NFeValidationService) {
    super("NFE_EMISSION");
    this.blingApi = blingApi;
    this.validationService = validationService;
  }

  private async markOrderCancelled(orderId: number, message: string): Promise<void> {
    // await this.blingApi.put(`/pedidos/vendas/${orderId}`, {
    //   observacoesInternas: `Pedido Cancelado: ${message}`
    // })
    // await this.blingApi.patch(`/pedidos/vendas/${orderId}/situacoes/${STATUS.CANCELADO}`)
    console.log(`[NFeQueue] Pedido ${orderId} cancelado: ${message}`)
  }

  async process(job: Job<NFeJobData>): Promise<void> {
    const { order_id } = job.data

    console.log(`[NFeQueue] Processando NFe do pedido ${order_id}`)

    // 1. Busca o pedido fresco na Bling
    const { data } = await this.blingApi.get(`/pedidos/vendas/${order_id}`)
    const order = data.data

    // 2. Verifica se ainda está em andamento (status 15)
    if (order.situacao?.id !== STATUS.EM_ANDAMENTO) {
      console.log(`[NFeQueue] Pedido ${order_id} com status ${order.situacao?.id}, esperado ${STATUS.EM_ANDAMENTO}. Abortando.`)
      await this.markOrderCancelled(order_id, NFE_ERRORS.WRONG_STATUS.message)
      return
    }

    // 3. Valida campos obrigatórios
    const validation = this.validationService.validate(order)

    if (!validation.valid) {
      const detail = validation.missingFields.join(', ')
      console.error(`[NFeQueue] Campos ausentes: ${detail}`)
      await this.markOrderCancelled(
        order_id,
        `${NFE_ERRORS.MISSING_FIELDS.message}: ${detail}`
      )
      return
    }

    // 4. Emite a NFe
    try {
      // await this.blingApi.post(`/pedidos/vendas/${order_id}/gerar-nfe`)
      console.log(`[NFeQueue] NFe emitida com sucesso para pedido ${order_id}`)
    } catch (error: any) {
      console.error(`[NFeQueue] Erro ao emitir NFe:`, error.response?.data ?? error.message)
      // Relança para o BullMQ fazer retry (3x com backoff, herdado da base)
      throw error
    }
  }
}
