import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

export const BLING_SHARED_QUEUE_LOCK: NonNullable<baseQueueOptions["sharedLock"]> = {
  key: "locks:bling:queues",
  ttlMs: 2 * 60 * 1000,       // 2min — se job morrer, libera rápido
  retryDelayMs: 500,           // checa a cada 500ms quem é o próximo

  // Sem aging: um rank baixo pode nunca rodar sob tráfego alto e sustentado
  // de rank mais alto (ex: BLING_API_FETCH sob rajada de webhooks). Por isso
  // NFE_EMISSION (prazo real de coleta) e NFE_RECONCILER (rede de segurança
  // que recria jobs perdidos) ficam nos ranks mais altos — não podem ficar
  // presos atrás de sync de catálogo/estoque.
  priority: {
    enabled: true,
    ranks: {
      NFE_EMISSION:         1, // emissão de notas com data próxima
      NFE_RECONCILER:       2, // busca notas perdidas
      BLING_API_FETCH:      3, // webhooks e upserts da bling
      BLING_STOCK_MOVEMENTS_SCRAPING: 4, // extração diária do CSV de estoque
      BLING_ORDER_INGESTION: 5, // criação/atualização de pedidos
      CNPJ_VERIFY_CNAE:     6, // verificação de CNAE
      ML_ORDER_SYNC:        7, // sincronização mercado livre
      BLING_NFE_SCRAPING:   8, // manifestacao automática bling
      BLING_RECONCILER:     9, // busca pedidos perdidos
    },
    defaultRank: 10,
  },
};
