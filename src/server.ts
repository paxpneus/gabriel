import "dotenv/config";
import { createServer } from "http";

import app from "./app";
import sequelize from "./config/sequelize";
import { registerQueues, startScrapingWorker } from "./queues";
import { setupAssociations } from "./config/sequelize-associations";
import { redisConnection } from "./shared/utils/base-models/base-redis";
import socketService from "./modules/handlers/socket/services/socket.service";
import { socketAuthMiddleware } from "./modules/handlers/socket/middlewares/socket-auth.middleware";
import { registerSocketHandlers } from "./modules/handlers/socket/services/socket.handler";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = "0.0.0.0";

async function start(): Promise<void> {
  await sequelize.authenticate();
  console.log("------------------- DB: Banco Conectado! ------------------- ");
  // await sequelize.sync({ alter: true })

  const httpServer = createServer(app);

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
  socketService.init(httpServer, redisConnection, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  socketService.useMiddleware(socketAuthMiddleware);
  socketService.registerHandlers(registerSocketHandlers);

  setupAssociations();
  registerQueues(app);

  startScrapingWorker()

  httpServer.listen(PORT, HOST, () => {
    console.log(`Servidor rodando em http://187.50.246.187:${PORT}`);
  });
}

start();
