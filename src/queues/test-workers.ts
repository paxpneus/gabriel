import { BlingDirectUpsertQueue } from "../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { BlingTokenRefreshQueue } from "../modules/handlers/bling/services/bling/queues/bling-refresh-token.queue";

export function startBlingWorkers() {
  console.log("🚀 Iniciando Bling workers isolados...");

  const blingDirectUpsertQueue = new BlingDirectUpsertQueue({ workless: false });
  const blingApiFetchQueue = new BlingApiFetchQueue({ workless: false });
  const blingTokenRefreshQueue = new BlingTokenRefreshQueue({ workless: false });

  blingTokenRefreshQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });

  console.log("✅ Workers ativos:");
  console.log("  → BlingDirectUpsertQueue");
  console.log("  → BlingApiFetchQueue");
  console.log("  → BlingTokenRefreshQueue (refresh a cada 5h)");

  return {
    blingDirectUpsertQueue,
    blingApiFetchQueue,
    blingTokenRefreshQueue,
  };
}