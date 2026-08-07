import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

export const BLING_SHARED_QUEUE_LOCK: NonNullable<baseQueueOptions["sharedLock"]> = {
  key: "locks:bling:queues",
  ttlMs: 2 * 60 * 1000,       // 2min — se job morrer, libera rápido
  retryDelayMs: 500,           // checa a cada 500ms quem é o próximo

  priority: {
    enabled: true,
    ranks: {
      BLING_API_FETCH:      1, // webhooks e upserts da bling
      BLING_STOCK_MOVEMENTS_SCRAPING: 2, // extração diária do CSV de estoque
      BLING_ORDER_INGESTION: 3, // criação/atualização de pedidos
      CNPJ_VERIFY_CNAE:     4, // verificação de CNAE
      ML_ORDER_SYNC:        5, // sincronização mercado livre
      BLING_NFE_SCRAPING:   6, // manifestacao automática bling
      NFE_RECONCILER:       7, // busca notas perdidas
      BLING_RECONCILER:     8, // busca pedidos perdidos
      NFE_EMISSION:         9, // emissão de notas com data próxima
      
    },
    defaultRank: 10,
  },
};
