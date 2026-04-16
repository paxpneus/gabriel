import { BlingDirectUpsertQueue } from "../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";

export function startBlingWorkers() {
  console.log("🚀 Iniciando Bling workers isolados...");

  // ✅ SOMENTE esses dois têm worker ativo
  const blingDirectUpsertQueue = new BlingDirectUpsertQueue({
    workless: false,
  });

  const blingApiFetchQueue = new BlingApiFetchQueue({
    workless: false,
  });

  console.log("✅ Workers ativos:");
  console.log("  → BlingDirectUpsertQueue");
  console.log("  → BlingApiFetchQueue");

  // ⚠️ mantém referência viva (evita GC matar worker)
  return {
    blingDirectUpsertQueue,
    blingApiFetchQueue,
  };
}