import Redis from "ioredis";
import dotenv from 'dotenv'

dotenv.config()

export const redisConfig = {
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB),
    maxRetriesPerRequest: null
};

// lazyConnect sob Jest: a maioria dos arquivos de teste não mocka este
// módulo (só importam algo que o importa de longe) e nunca chama um
// comando real neste client — mas o `new Redis(...)` já abre a conexão
// (e o retry infinito do ioredis quando REDIS_HOST está indisponível,
// já que maxRetriesPerRequest:null é exigido pelo BullMQ) na hora, e esse
// handle nunca fecha sozinho. Isso deixava a suíte inteira sem sair
// ("Jest did not exit"), o que passa despercebido localmente mas derruba
// `npm test` com exit code != 0 no build Docker (rede mais restrita). Só
// afeta este client — `redisConfig` (reexportado e usado por
// base-queue-service.ts/integrations.service.ts pra montar as conexões
// reais do BullMQ) continua intacto.
const redisClient = new Redis(
  process.env.JEST_WORKER_ID
    ? { ...redisConfig, lazyConnect: true }
    : redisConfig,
);
export { redisClient }