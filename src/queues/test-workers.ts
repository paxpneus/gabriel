import { BlingDirectUpsertQueue } from "../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { BlingTokenRefreshQueue } from "../modules/handlers/bling/services/bling/queues/bling-refresh-token.queue";
import { BlingMigrationQueue } from "../modules/handlers/bling/services/bling/queues/bling-daily-recover";
import { TCarUpsertQueue } from "../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import { REPORT_HOURLY_TASK, ReportQueue } from "../modules/reports/report.queue";
import { AutoBackupQueue } from "../modules/handlers/backup/auto-backup.queue";

export async function startBlingWorkers() {
  console.log("🚀 Iniciando Bling workers isolados...");

  const blingDirectUpsertQueue = new BlingDirectUpsertQueue({
    workless: false,
  });
  const blingApiFetchQueue = new BlingApiFetchQueue({ workless: false });
  const blingTokenRefreshQueue = new BlingTokenRefreshQueue({
    workless: false,
  });
  const blingDailyReconciler = new BlingMigrationQueue({ workless: false });
  const reportQueue = new ReportQueue({ workless: false });

  const tcarApiFetchQueue = new TCarUpsertQueue({ workless: false });

  const autoBackUpQueue = new AutoBackupQueue({ workless: false });

  blingTokenRefreshQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  blingDailyReconciler.scheduleRepeat({ every: 24 * 60 * 60 * 1000 });
  // Um repeat só: o "hourly" enfileira seller → sales → daily operation, um por vez.
  reportQueue.scheduleRepeat({
    every: 1 * 60 * 60 * 1000,
    data: { task: REPORT_HOURLY_TASK },
  });
  autoBackUpQueue.scheduleRepeat({
    cron: "0 19 * * *",
    tz: "America/Sao_Paulo",
  });

  console.log("✅ Workers ativos:");
  console.log("  → BlingDirectUpsertQueue");
  console.log("  → BlingApiFetchQueue");
  console.log("  → BlingTokenRefreshQueue (refresh a cada 1h)");
  console.log("  → ReportQueue (seller sales → sales → daily operation, a cada 1h)");
  console.log("  → SefazDistribuicaoQueue (a cada 1h)");

  return {
    blingDirectUpsertQueue,
    blingApiFetchQueue,
    blingTokenRefreshQueue,
    reportQueue,
    // tcarApiFetchQueue,
  };
}