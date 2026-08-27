import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { TCarUpsertQueue } from "../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import { runMigration } from "./tecinco-migration.runner";
import { UnitBusiness } from "../../modules/warehouse";
import { Op } from "sequelize";
import { tecincoUnitBusinessForPopulate } from "../../shared/constants/tecinco-units";
import { tecincoTireGrupoIds } from "../../shared/constants/tecinco-groups";

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const ALTERADO_DESDE = process.env.TCAR_ALTERADO_DESDE;
const GRUPOS = tecincoTireGrupoIds;

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const units = await UnitBusiness.findAll({
    attributes: ["id", "id_system", "number"],
    where: {
      number: {
        [Op.in]: tecincoUnitBusinessForPopulate,
      },
    },
  });
  const branchIds: number[] = units.map((u) => Number(u.number));

  console.log("═".repeat(55));
  console.log("  🚀 TeCinco → Filas — Script de Migração");
  console.log(`  🏢 Filiais: ${branchIds.join(", ")}`);
  if (ALTERADO_DESDE) {
    console.log(`  📅 Incremental desde: ${ALTERADO_DESDE}`);
  }
  console.log("═".repeat(55));

  const upsertQueue = new TCarUpsertQueue({ workless: true });
  const start = Date.now();

  try {
    await runMigration({
      branchIds,
      companyId: COMPANY_ID,
      alteradoDesde: ALTERADO_DESDE,
      upsertQueue,
      grupos: GRUPOS,
    });
  } catch (err: any) {
    console.error("\n❌ Erro durante a migração:", err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("═".repeat(55));
  console.log(`  ✅ Migração concluída em ${elapsed}s`);
  console.log("═".repeat(55));

  process.exit(0);
}

main();
