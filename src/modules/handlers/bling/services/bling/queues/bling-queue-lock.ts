import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

// Histórico: isto já foi um mutex compartilhado por 7 filas do pipeline de
// pedido inteiro (NFE_EMISSION, NFE_RECONCILER, BLING_ORDER_INGESTION,
// CNPJ_VERIFY_CNAE, ML_ORDER_SYNC, BLING_RECONCILER + este). Foi substituído
// por lock por PEDIDO (withOrderLock em base-queue-service.ts, chave
// dinâmica) nessas 6 filas — pedidos diferentes agora correm em paralelo de
// verdade entre elas, serializando só quando duas realmente tocam o MESMO
// pedido. Hoje só BLING_API_FETCH ainda usa este lock (sozinho, sem
// contenção real — os ranks abaixo continuam corretos caso outra fila
// precise voltar a compartilhar este recurso no futuro, mas não fazem mais
// diferença prática hoje).
export const BLING_SHARED_QUEUE_LOCK: NonNullable<baseQueueOptions["sharedLock"]> = {
  key: "locks:bling:queues",
  ttlMs: 2 * 60 * 1000,       // 2min — se job morrer, libera rápido
  retryDelayMs: 500,           // checa a cada 500ms quem é o próximo

  // NFE_EMISSION (prazo real de coleta) e NFE_RECONCILER (rede de segurança
  // que recria jobs perdidos) ficam nos ranks mais altos — não podem ficar
  // presos atrás de sync de catálogo/estoque.
  //
  // Aging (agingIntervalMs): confirmado em produção que rank fixo sem aging
  // faz um rank baixo nunca rodar sob tráfego alto e sustentado de rank mais
  // alto — ML_ORDER_SYNC (rank 7) ficava preso atrás do fluxo contínuo de
  // BLING_API_FETCH (webhooks), e como ML_ORDER_SYNC é quem aplica a
  // collection_date que destrava o pedido, o NFE_RECONCILER (rank 2, que não
  // depende do lock pra decidir isso) acabava marcando esses pedidos como
  // "aguardando verificação humana" por estarem há >30min sem avançar, mesmo
  // com a data de coleta já achada pelo scraping. Com aging, o rank efetivo
  // de um ticket melhora 1 nível a cada agingIntervalMs esperando (nunca
  // passa do rank 1), garantindo que nenhuma fila fique presa pra sempre.
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
    agingIntervalMs: 2 * 60 * 1000,
  },
};
