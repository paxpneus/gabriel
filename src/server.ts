import { setupAdminJS } from './admin';
import "dotenv/config";
import { createServer } from "http";

import app, {initApp} from "./app";
import sequelize from "./config/sequelize";
import { registerQueues } from "./queues";
import { setupAssociations } from "./config/sequelize-associations";
import { redisConnection } from "./shared/utils/base-models/base-redis";
import socketService from "./modules/handlers/socket/services/socket.service";
import { socketAuthMiddleware } from "./modules/handlers/socket/middlewares/socket-auth.middleware";
import { registerSocketHandlers } from "./modules/handlers/socket/services/socket.handler";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = "0.0.0.0";
const SHUTDOWN_TIMEOUT_MS = 10_000;

let httpServer: ReturnType<typeof createServer> | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recebido, drenando conexões antes de sair...`);

  const forceExit = setTimeout(() => {
    console.error("Timeout no shutdown gracioso, encerrando à força.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await socketService.close();
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await sequelize.close();
    console.log("Shutdown concluído.");
    process.exit(0);
  } catch (err) {
    console.error("Erro durante o shutdown gracioso:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function start(): Promise<void> {
  await sequelize.authenticate();
  console.log("------------------- DB: Banco Conectado! ------------------- ");
  // await sequelize.sync({ alter: true })

  await initApp();

  httpServer = createServer(app);

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [];
  socketService.init(httpServer, redisConnection, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  socketService.useMiddleware(socketAuthMiddleware);
  socketService.registerHandlers(registerSocketHandlers);

  setupAssociations();
  registerQueues(app);
  // startTecincoWorkers()
  // startBlingWorkers();

  httpServer.listen(PORT, HOST, () => {
    console.log(`Servidor rodando em http://187.50.246.187:${PORT}`);
  });
}

start();
