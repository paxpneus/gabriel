import { BlingDirectUpsertQueue } from "../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { BlingTokenRefreshQueue } from "../modules/handlers/bling/services/bling/queues/bling-refresh-token.queue";
import { BlingMigrationQueue } from "../modules/handlers/bling/services/bling/queues/bling-daily-recover";
import { TCarUpsertQueue } from "../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import { DailyOperationReportQueue } from "../modules/reports/daily-operation/daily-operation-report/daily-operation-report.queue";
import { SalesReportQueue } from "../modules/reports/daily-sales/sales-report/sales-report.queue";
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
  const dailyOperationReportQueue = new DailyOperationReportQueue({
    workless: false,
  });

  const tcarApiFetchQueue = new TCarUpsertQueue({ workless: false });

  const dailySalesReportQueue = new SalesReportQueue({ workless: false });
  const autoBackUpQueue = new AutoBackupQueue({ workless: false });

  blingTokenRefreshQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  blingDailyReconciler.scheduleRepeat({ every: 24 * 60 * 60 * 1000 });
  dailyOperationReportQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
  autoBackUpQueue.scheduleRepeat({
    cron: "0 19 * * *",
    tz: "America/Sao_Paulo",
  });

  setTimeout(
    () => {
      dailySalesReportQueue.scheduleRepeat({ every: 1 * 60 * 60 * 1000 });
      console.log(
        "  → SalesReportQueue (relatório comercial a cada 1h, offset 30min)",
      );
    },
    30 * 60 * 1000,
  );

  console.log("✅ Workers ativos:");
  console.log("  → BlingDirectUpsertQueue");
  console.log("  → BlingApiFetchQueue");
  console.log("  → BlingTokenRefreshQueue (refresh a cada 1h)");
  console.log(
    "  → DailyOperationReportQueue (relatório operacional a cada 1h)",
  );
  console.log("  → SefazDistribuicaoQueue (a cada 1h)");

  return {
    blingDirectUpsertQueue,
    blingApiFetchQueue,
    blingTokenRefreshQueue,
    dailyOperationReportQueue,
    // tcarApiFetchQueue,
  };
}