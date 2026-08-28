/**
 * dump-tecinco-catalog.ts
 *
 * Extrai o catálogo completo de produtos da Tecinco (grupos de pneus,
 * unit businesses configuradas para populate) para um JSON simples em
 * disco — sem tocar no banco local. Insumo para match-tecinco-products.ts.
 *
 * Uso:
 *   npx ts-node src/scripts/tecinco/dump-tecinco-catalog.ts
 */

import * as fs from "fs";
import * as path from "path";
import { Op } from "sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { UnitBusiness } from "../../modules/warehouse";
import { TCarProdutoService } from "../../modules/handlers/tecinco/service/produtos/produtos.service";
import { TCarProdutoPayload } from "../../modules/handlers/tecinco/service/tecinco/tecinco.types";
import { tecincoUnitBusinessForPopulate } from "../../shared/constants/tecinco-units";
import { tecincoTireGrupoIds } from "../../shared/constants/tecinco-groups";
import { paginateTCar } from "./tecinco-migration.runner";

export interface TecincoCatalogItem {
  id_sistema: string;
  sku: string | null;
  ean: string | null;
  nome: string;
  grupo: string | null;
  subgrupo: string | null;
  marca: string | null;
}

export const CATALOG_OUTPUT_PATH = path.join(
  __dirname,
  "output",
  "tecinco-catalog.json",
);

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const units = await UnitBusiness.findAll({
    attributes: ["id", "id_system", "number"],
    where: { number: { [Op.in]: tecincoUnitBusinessForPopulate } },
  });
  const branchIds: number[] = units.map((u) => Number(u.number));
  const primaryBranchId = branchIds[0];
  const branchIdsParam = branchIds.join(",");

  console.log("═".repeat(55));
  console.log("  📥 Dump do catálogo Tecinco");
  console.log(`  🏢 Filiais: ${branchIdsParam}`);
  console.log("═".repeat(55));

  const service = new TCarProdutoService();
  const items: TecincoCatalogItem[] = [];
  const countByGrupo: Record<string, number> = {};

  for (const grupo of tecincoTireGrupoIds) {
    console.log(`  🔖 Grupo ${grupo}`);
    let grupoCount = 0;

    for await (const page of paginateTCar<TCarProdutoPayload>((offset, limit) =>
      service.listarProdutos(primaryBranchId, {
        offset,
        limit,
        include: "filiais",
        branch_ids: branchIdsParam,
        grupo,
      }),
    )) {
      for (const p of page) {
        items.push({
          id_sistema: String(p.epctb_codigo),
          sku: p.epctb_codigofabrica ?? null,
          ean: p.epctb_ean ?? null,
          nome: p.epctb_nome,
          grupo: p.grupo_descricao ?? null,
          subgrupo: p.subgrupo_descricao ?? null,
          marca: p.marca_descricao ?? null,
        });
        grupoCount++;
      }
    }

    countByGrupo[grupo] = grupoCount;
    console.log(`    → ${grupoCount} produto(s)`);
  }

  fs.mkdirSync(path.dirname(CATALOG_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_OUTPUT_PATH, JSON.stringify(items, null, 2));

  console.log("─".repeat(55));
  console.log(`  ✅ Total: ${items.length} produto(s)`);
  console.log(`  📊 Por grupo: ${JSON.stringify(countByGrupo)}`);
  console.log(`  💾 Salvo em: ${CATALOG_OUTPUT_PATH}`);
  console.log("═".repeat(55));

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erro ao extrair catálogo Tecinco:", err);
  process.exit(1);
});
