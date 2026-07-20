import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

export const BLING_SHARED_QUEUE_LOCK: NonNullable<baseQueueOptions["sharedLock"]> = {
  key: "locks:bling:queues",
  ttlMs: 2 * 60 * 1000,       // 2min — se job morrer, libera rápido
  retryDelayMs: 500,           // checa a cada 500ms quem é o próximo

  priority: {
    enabled: true,
    ranks: {
      BLING_API_FETCH:      1, // webhooks e upserts da bling
      BLING_ORDER_INGESTION:2, // criação/atualização de pedidos
      CNPJ_VERIFY_CNAE:     3, // verificação de CNAE
      ML_ORDER_SYNC:        4, // sincronização mercado livre
      NFE_RECONCILER:       5, // busca notas perdidas
      BLING_RECONCILER:     6, // busca pedidos perdidos
      NFE_EMISSION:         7, // emissão de notas com data próxima
      
    },
    defaultRank: 10,
  },
};