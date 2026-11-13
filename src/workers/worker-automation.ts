import "dotenv/config";
import sequelize from "../config/sequelize";
import { setupAssociations } from "../config/sequelize-associations";
import { startAutomationWorkers } from "../queues";
import { startHealthServer } from "./health-server";

async function start(): Promise<void> {
  await sequelize.authenticate();
  console.log("------------------- DB: Banco Conectado! -------------------");
  setupAssociations();
  // DESATIVADO (kill switch Bling): sem isso nenhuma fila de automação consome/agenda, logo nada escreve na Bling.
  // startAutomationWorkers();
  startHealthServer();
}

start();
