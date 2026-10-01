/**
 * Backfill idempotente dos campos de desconto das PURCHASE_ENTRY (regras e env em .claude/entities/stock-movement.md).
 */
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import unitBusinessService from "../../modules/company/unit-business/unit-business.service";
import stockMovementService from "../../modules/inventory/stock/stock-movements/stock-movements.service";
import stockMovementRepository from "../../modules/inventory/stock/stock-movements/stock-movements.repository";

const DRY_RUN = process.env.DRY_RUN !== "false";
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 0);
const ANOMALY_SAMPLE_SIZE = 20;

async function resolveUnitBusinessId(): Promise<string> {
  if (process.env.UNIT_BUSINESS_ID) return process.env.UNIT_BUSINESS_ID;

  const store = await unitBusinessService.getCd21UnitBusiness();
  if (!store) throw new Error("Unidade CD21 (Loja 21) não cadastrada");
  return store.id;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const unitBusinessId = await resolveUnitBusinessId();
  let productIds =
    await stockMovementRepository.findProductIdsWithPurchaseEntries(
      unitBusinessId,
    );
  if (MAX_PRODUCTS) productIds = productIds.slice(0, MAX_PRODUCTS);

  console.log(
    `[BackfillDiscounts] unit_business=${unitBusinessId} produtos=${productIds.length} ` +
      `lote=${BATCH_SIZE} DRY_RUN=${DRY_RUN}`,
  );

  const totals = {
    entries: 0,
    changed: 0,
    withAdjustment: 0,
    withoutAdjustment: 0,
  };
  const anomalyCounts = new Map<string, number>();
  const anomalySamples: string[] = [];
  let failedBatches = 0;

  const batches = chunk(productIds, BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const transaction = await sequelize.transaction();
    try {
      const result = await stockMovementService.recalculatePurchaseEntryDiscounts(
        batch,
        unitBusinessId,
        transaction,
      );

      if (DRY_RUN) await transaction.rollback();
      else await transaction.commit();

      totals.entries += result.entries;
      totals.changed += result.changed;
      totals.withAdjustment += result.withAdjustment;
      totals.withoutAdjustment += result.withoutAdjustment;

      for (const anomaly of result.anomalies) {
        anomalyCounts.set(anomaly.kind, (anomalyCounts.get(anomaly.kind) ?? 0) + 1);
        if (anomalySamples.length < ANOMALY_SAMPLE_SIZE) {
          anomalySamples.push(
            `${anomaly.kind} movement=${anomaly.id} invoice=${anomaly.invoice_number ?? "-"}`,
          );
        }
      }

      console.log(
        `[BackfillDiscounts] lote ${index + 1}/${batches.length}: ` +
          `entradas=${result.entries} alteradas=${result.changed} anomalias=${result.anomalies.length}`,
      );
    } catch (error: any) {
      await transaction.rollback().catch(() => undefined);
      failedBatches++;
      console.error(
        `[BackfillDiscounts] lote ${index + 1}/${batches.length} falhou (rollback): ${error?.message ?? error}`,
      );
    }
  }

  console.log("═".repeat(60));
  console.log(`  Modo: ${DRY_RUN ? "DRY_RUN (nada gravado)" : "EXECUÇÃO REAL"}`);
  console.log(`  PURCHASE_ENTRY processadas: ${totals.entries}`);
  console.log(`  Com ajuste: ${totals.withAdjustment}`);
  console.log(`  Sem ajuste: ${totals.withoutAdjustment}`);
  console.log(`  Linhas ${DRY_RUN ? "que seriam alteradas" : "alteradas"}: ${totals.changed}`);
  console.log(`  Lotes com falha: ${failedBatches}`);
  if (anomalyCounts.size) {
    console.log("  Anomalias:");
    for (const [kind, count] of anomalyCounts) console.log(`    - ${kind}: ${count}`);
    console.log(`  Amostra (até ${ANOMALY_SAMPLE_SIZE}):`);
    for (const sample of anomalySamples) console.log(`    · ${sample}`);
  }
  console.log("═".repeat(60));

  process.exit(failedBatches > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("\n❌ Erro fatal:", error);
    process.exit(1);
  });
}
