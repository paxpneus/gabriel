// Script manual pra validar o scraping da tela de detalhe do pedido do
// Mercado Livre contra o site real (login logado via ./ml_session).
//
// Uso:
//   npx ts-node src/scripts/mercado-livre/test-scrape-order.ts <number_order_channel>
// ou, via env:
//   ML_TEST_ORDER_NUMBER=2000015142170713 npx ts-node src/scripts/mercado-livre/test-scrape-order.ts
//
// Abre o browser (headless conforme ML_HEADLESS/NODE_ENV — ver
// mercado-livre-scraping.service.ts), navega até ML_ORDER_DETAIL_URL com o
// number_order_channel informado, extrai a collection_date e imprime o
// resultado. Não grava nada no banco nem chama a Bling — só valida a
// extração do DOM.
import "dotenv/config";
import { MLScrapingService } from "../../modules/handlers/mercado-livre/services/mercado-livre-scraping.service";

async function main() {
  const orderNumber = process.argv[2] ?? process.env.ML_TEST_ORDER_NUMBER;

  if (!orderNumber) {
    console.error(
      "Uso: npx ts-node src/scripts/mercado-livre/test-scrape-order.ts <number_order_channel>",
    );
    process.exit(1);
  }

  console.log(`[test-scrape-order] Extraindo pedido ML ${orderNumber}...`);

  const scrapingService = new MLScrapingService();
  const result = await scrapingService.scrapeOrderDetail(orderNumber);

  if (!result) {
    console.log(
      `[test-scrape-order] Nenhuma das duas condições (NF-e já emitida / coleta do dia X) foi encontrada na tela do pedido ${orderNumber}.`,
    );
    process.exit(1);
  }

  console.log("[test-scrape-order] Resultado:", {
    order_number: result.order_number,
    collection_date: result.collection_date.toISOString(),
  });
  process.exit(0);
}

main().catch((error) => {
  console.error("[test-scrape-order] Falhou:", error);
  process.exit(1);
});
