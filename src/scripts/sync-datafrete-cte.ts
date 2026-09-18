import "dotenv/config";
import { setupAssociations } from "../config/sequelize-associations";
import syncDatafreteCteService from "../modules/handlers/logistic/services/sync-datafrete-cte.service";

async function main() {
  setupAssociations();

  const result = await syncDatafreteCteService.syncPendingCtes();
  console.log("[sync-datafrete-cte] Resultado:", result);
}

main()
  .catch(console.error)
  .finally(() => process.exit());
