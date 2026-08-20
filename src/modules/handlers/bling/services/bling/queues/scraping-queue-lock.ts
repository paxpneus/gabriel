import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

// Serializa as filas que abrem browser (Playwright/Puppeteer) no container
// worker-scraping, evitando que rodem em paralelo e disputem CPU/memória
// entre si — o que pode causar timeouts de seletor/navegação por lentidão
// de renderização, não por falha real do fluxo.
export const SCRAPING_SHARED_QUEUE_LOCK: NonNullable<baseQueueOptions["sharedLock"]> = {
  key: "locks:scraping:queues",
  ttlMs: 2 * 60 * 1000,       // 2min — se job morrer, libera rápido
  retryDelayMs: 500,           // checa a cada 500ms quem é o próximo

  priority: {
    enabled: true,
    ranks: {
      BLING_STOCK_MOVEMENTS_SCRAPING: 1, // extração diária do CSV de estoque
      "ML-SCRAPING":                  2, // sincronização de vendas do Mercado Livre
      BLING_NFE_SCRAPING:             3, // manifestação automática bling
    },
    defaultRank: 4,
  },
};
