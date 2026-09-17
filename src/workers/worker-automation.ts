import "dotenv/config";
import sequelize from "../config/sequelize";
import { setupAssociations } from "../config/sequelize-associations";
import { startAutomationWorkers } from "../queues";

async function start(): Promise<void> {
  await sequelize.authenticate();
  console.log("------------------- DB: Banco Conectado! -------------------");
  console.log(`Versão ativa: ${process.env.APP_VERSION ?? "unknown"}`);
  setupAssociations();
  startAutomationWorkers();
}

start();
