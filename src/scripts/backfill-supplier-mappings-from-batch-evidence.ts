/**
 * backfill-supplier-mappings-from-batch-evidence.ts
 *
 * Reconstrói/valida product_supplier_maps a partir de evidência real e
 * verificada fisicamente — não da duplicação "às cegas" que a migration
 * m263-scope-supplier-mapping-by-integration.js fez (que duplicou qualquer
 * SupplierMapping ambíguo pras duas integrações sempre que o PRODUTO tinha
 * mapping em ambas, mesmo sem nenhuma prova de que aquele código específico
 * foi visto em cada uma).
 *
 * Evidência usada (bem mais forte que "existe uma nota"): batch_invoice_items
 * com quantity_read > 0 — ou seja, um item que alguém realmente bipou/conferiu
 * fisicamente contra uma nota fiscal específica dentro de um lote de
 * expedição. A partir do product_id do expedition_batch_items (já resolvido
 * e confirmado pela conferência física) e do invoice_id do batch, busca o
 * invoice_fiscal_item correspondente pra pegar o código exatamente como veio
 * no XML daquela nota (gtin, com sku como fallback — mesma prioridade que
 * o resto do sistema usa ao criar SupplierMapping).
 *
 * Cadeia:
 *   batch_invoice_items (quantity_read > 0)
 *     → expedition_batch_invoices (invoice_id)
 *     → expedition_batch_items (product_id)
 *     → invoice_fiscal_items (mesmo invoice_id + product_id → gtin/sku)
 *     → invoices (sender_cnpj)
 *     → invoice_unit_business_attributes (type=INCOMING → unit_business_id)
 *     → unit_businesses (integrations_id)
 *
 * Modo padrão é DRY_RUN (só relatório, nada é escrito). Só aplica de
 * verdade com SUPPLIER_MAPPING_BACKFILL_APPLY=true explícito (nome de
 * variável exclusivo deste script — nunca reusar DRY_RUN genérico, que já
 * é usado por outros scripts e pode vir "false" herdado do .env).
 *
 * Uso:
 *   npx ts-node src/scripts/backfill-supplier-mappings-from-batch-evidence.ts
 *   SUPPLIER_MAPPING_BACKFILL_APPLY=true npx ts-node src/scripts/backfill-supplier-mappings-from-batch-evidence.ts
 */

import { QueryTypes, UniqueConstraintError } from "sequelize";
import * as fs from "fs";
import * as path from "path";
import sequelize from "../config/sequelize";
import { setupAssociations } from "../config/sequelize-associations";
import { SupplierMapping, ProductConfig } from "../modules/inventory";
import { UnitBusiness } from "../modules/warehouse";

const DRY_RUN = process.env.SUPPLIER_MAPPING_BACKFILL_APPLY !== "true";

interface EvidencedTuple {
  product_id: string;
  code: string;
  supplier_cnpj: string | null;
  unit_business_id: string;
  integrations_id: string;
  integration_name: string;
}

async function fetchEvidencedTuples(): Promise<EvidencedTuple[]> {
  return sequelize.query<EvidencedTuple>(
    `
    SELECT DISTINCT ON (ebit.product_id, code, ub.integrations_id)
      ebit.product_id                     AS product_id,
      COALESCE(fi.gtin, fi.sku)           AS code,
      i.sender_cnpj                       AS supplier_cnpj,
      ub.id                               AS unit_business_id,
      ub.integrations_id                  AS integrations_id,
      integ.name                          AS integration_name
    FROM batch_invoice_items bii
    JOIN expedition_batch_invoices ebi
      ON ebi.id = bii.expedition_batch_invoice_id
    JOIN expedition_batch_items ebit
      ON ebit.id = bii.expedition_batch_item_id
    JOIN invoice_fiscal_items fi
      ON fi.invoice_id = ebi.invoice_id
     AND fi.product_id = ebit.product_id
    JOIN invoices i
      ON i.id = ebi.invoice_id
    JOIN invoice_unit_business_attributes iuba
      ON iuba.invoice_id = i.id
     AND iuba.type = 'INCOMING'
    JOIN unit_businesses ub
      ON ub.id = iuba.unit_business_id
    JOIN integrations integ
      ON integ.id = ub.integrations_id
    WHERE bii.quantity_read > 0
      AND COALESCE(fi.gtin, fi.sku) IS NOT NULL
      AND ub.integrations_id IS NOT NULL
    ORDER BY ebit.product_id, code, ub.integrations_id, i.created_at DESC
    `,
    { type: QueryTypes.SELECT },
  );
}

type Outcome =
  | "would_create"
  | "created"
  | "already_correct"
  | "conflict_different_product"
  | "conflict_gtin_trigger"
  | "error";

interface ResultRow extends EvidencedTuple {
  outcome: Outcome;
  detail?: string;
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  console.log("═".repeat(60));
  console.log(
    `  Backfill de SupplierMapping via evidência de batch (quantity_read > 0)`,
  );
  console.log(`  Modo: ${DRY_RUN ? "DRY_RUN (nada será escrito)" : "EXECUÇÃO REAL"}`);
  console.log("═".repeat(60));

  const tuples = await fetchEvidencedTuples();
  console.log(`\n📋 ${tuples.length} tuplas evidenciadas (produto+código+integração)\n`);

  const results: ResultRow[] = [];

  for (const tuple of tuples) {
    const existing = await SupplierMapping.findOne({
      where: {
        integrations_id: tuple.integrations_id,
        supplier_product_code: tuple.code,
      },
    });

    if (existing) {
      if (existing.product_id === tuple.product_id) {
        results.push({ ...tuple, outcome: "already_correct" });
      } else {
        results.push({
          ...tuple,
          outcome: "conflict_different_product",
          detail: `SupplierMapping existente (id=${existing.id}) aponta pro produto ${existing.product_id}, evidência de batch aponta pro produto ${tuple.product_id}`,
        });
      }
      continue;
    }

    // Pré-checagem do mesmo conflito que o trigger de banco valida (gtin
    // de OUTRO produto na mesma integração) — pra reportar sem precisar tentar
    // o INSERT e tratar exception em DRY_RUN.
    const conflictingConfig = await ProductConfig.findOne({
      where: { gtin: tuple.code },
      include: [
        {
          model: UnitBusiness,
          as: "unitBusiness",
          required: true,
          where: { integrations_id: tuple.integrations_id },
        },
      ],
    });

    if (
      conflictingConfig &&
      (conflictingConfig as any).product_id !== tuple.product_id
    ) {
      results.push({
        ...tuple,
        outcome: "conflict_gtin_trigger",
        detail: `código ${tuple.code} já é gtin do produto ${(conflictingConfig as any).product_id} nessa integração`,
      });
      continue;
    }

    if (DRY_RUN) {
      results.push({ ...tuple, outcome: "would_create" });
      continue;
    }

    try {
      await SupplierMapping.create({
        product_id: tuple.product_id,
        supplier_cnpj: tuple.supplier_cnpj ?? undefined,
        supplier_product_code: tuple.code,
        integrations_id: tuple.integrations_id,
      });
      results.push({ ...tuple, outcome: "created" });
    } catch (err: any) {
      results.push({
        ...tuple,
        outcome: err instanceof UniqueConstraintError ? "conflict_different_product" : "error",
        detail: err?.message,
      });
    }
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log("─".repeat(60));
  console.log("📊 Resumo:");
  for (const [outcome, count] of Object.entries(counts)) {
    console.log(`   ${outcome}: ${count}`);
  }
  console.log("─".repeat(60));

  const conflicts = results.filter((r) => r.outcome.startsWith("conflict") || r.outcome === "error");
  if (conflicts.length) {
    console.log(`\n⚠️  ${conflicts.length} conflito(s) — revisão manual necessária:\n`);
    for (const c of conflicts) {
      console.log(
        `   [${c.outcome}] produto=${c.product_id} código=${c.code} integração=${c.integration_name} — ${c.detail ?? ""}`,
      );
    }
  }

  const outDir = path.join(__dirname, "output");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `backfill-supplier-mappings-${DRY_RUN ? "dry-run" : "applied"}-${Date.now()}.json`,
  );
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Relatório completo salvo em: ${outPath}`);
}

main()
  .then(() => {
    console.log("\n🏁 Concluído.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Erro fatal:", err);
    process.exit(1);
  });
