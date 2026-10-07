/**
 * Junta contatos SELLER duplicados (mesmo id_system + integração) num contato só:
 * repassa seller_id de pedidos/notas/snapshots/facts e integration mappings pro
 * contato canônico e apaga os duplicados.
 *
 * Canônico = o que tem integration mapping CONTACT do id_system; sem mapping, o
 * com mais pedidos (empate: o mais antigo).
 *
 * Uso:
 *   npx ts-node src/scripts/bling/merge-duplicate-sellers.ts
 *
 * Env:
 *   DRY_RUN=true → só lista os grupos e o que seria movido, sem gravar
 */

import { QueryTypes, Transaction } from "sequelize";
import sequelize from "../../config/sequelize";

const DRY_RUN = process.env.DRY_RUN === "true";

const SELLER_FK_TABLES = [
  "orders",
  "invoices",
  "sales_order_snapshots",
  "seller_sales_order_item_snapshots",
  "daily_seller_customer_facts",
  "daily_seller_product_facts",
];

// Facts têm UNIQUE (fact_date, seller_id, <coluna>) — repassar sem checar quebraria a constraint.
const FACT_UNIQUE_COLUMNS: Record<string, string> = {
  daily_seller_customer_facts: "customer_id",
  daily_seller_product_facts: "product_id",
};

interface SellerRow {
  id: string;
  id_system: string;
  integrations_id: string;
  name: string;
  user_id: string | null;
  document: string | null;
  orders_count: number;
  has_mapping: boolean;
}

async function findDuplicateSellers(): Promise<SellerRow[]> {
  return sequelize.query<SellerRow>(
    `
    SELECT c.id, c.id_system, c.integrations_id, c.name, c.user_id, c.document,
           (SELECT COUNT(*)::int FROM orders o WHERE o.seller_id = c.id) AS orders_count,
           EXISTS (
             SELECT 1 FROM integration_mappings im
             WHERE im.entity_type = 'CONTACT'
               AND im.internal_id = c.id::text
               AND im.integrations_id = c.integrations_id
               AND im.external_id = c.id_system
           ) AS has_mapping
    FROM contacts c
    WHERE c.type = 'SELLER'
      AND (c.id_system, c.integrations_id) IN (
        SELECT id_system, integrations_id FROM contacts
        WHERE type = 'SELLER'
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
      )
    ORDER BY c.id_system, c.created_at
    `,
    { type: QueryTypes.SELECT },
  );
}

function pickCanonical(group: SellerRow[]): SellerRow {
  const mapped = group.filter((s) => s.has_mapping);
  if (mapped.length > 1) {
    throw new Error(
      `id_system=${group[0].id_system}: mais de um contato com mapping (${mapped.map((s) => s.id).join(", ")})`,
    );
  }
  if (mapped.length === 1) return mapped[0];
  // group já vem ordenado por created_at; sort estável mantém o mais antigo no empate.
  return [...group].sort((a, b) => b.orders_count - a.orders_count)[0];
}

async function findFactConflicts(
  canonicalId: string,
  duplicateIds: string[],
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const [table, column] of Object.entries(FACT_UNIQUE_COLUMNS)) {
    const [{ count }] = await sequelize.query<{ count: number }>(
      `
      SELECT COUNT(*)::int AS count
      FROM ${table} d
      JOIN ${table} c
        ON c.seller_id = :canonicalId
       AND c.fact_date = d.fact_date
       AND c.${column} = d.${column}
      WHERE d.seller_id IN (:duplicateIds)
      `,
      { type: QueryTypes.SELECT, replacements: { canonicalId, duplicateIds } },
    );
    if (count > 0) conflicts.push(`${table}: ${count}`);
  }
  return conflicts;
}

async function countReferences(duplicateIds: string[]) {
  const counts: Record<string, number> = {};
  for (const table of SELLER_FK_TABLES) {
    const [{ count }] = await sequelize.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE seller_id IN (:duplicateIds)`,
      { type: QueryTypes.SELECT, replacements: { duplicateIds } },
    );
    counts[table] = count;
  }
  return counts;
}

async function mergeGroup(
  canonical: SellerRow,
  duplicates: SellerRow[],
  transaction: Transaction,
) {
  const duplicateIds = duplicates.map((d) => d.id);
  const replacements = { canonicalId: canonical.id, duplicateIds };

  for (const table of SELLER_FK_TABLES) {
    await sequelize.query(
      `UPDATE ${table} SET seller_id = :canonicalId WHERE seller_id IN (:duplicateIds)`,
      { replacements, transaction },
    );
  }

  // Mapping do duplicado que o canônico já tem (mesma integração + external_id) é descartado; o resto é repassado.
  await sequelize.query(
    `
    DELETE FROM integration_mappings d
    WHERE d.entity_type = 'CONTACT'
      AND d.internal_id IN (:duplicateIds)
      AND EXISTS (
        SELECT 1 FROM integration_mappings c
        WHERE c.entity_type = 'CONTACT'
          AND c.internal_id = :canonicalId
          AND c.integrations_id = d.integrations_id
          AND c.external_id = d.external_id
      )
    `,
    { replacements: { canonicalId: canonical.id, duplicateIds: duplicateIds.map(String) }, transaction },
  );
  await sequelize.query(
    `UPDATE integration_mappings SET internal_id = :canonicalId
     WHERE entity_type = 'CONTACT' AND internal_id IN (:duplicateIds)`,
    { replacements: { canonicalId: canonical.id, duplicateIds: duplicateIds.map(String) }, transaction },
  );

  // Preenche no canônico só o que ele não tem; user_id é UNIQUE, então sai do duplicado antes.
  const donor = duplicates.find((d) => d.user_id) ?? null;
  const fallbackName = `Vendedor ${canonical.id_system}`;
  const realName =
    canonical.name === fallbackName
      ? duplicates.find((d) => d.name !== fallbackName)?.name ?? null
      : null;
  const document = canonical.document ?? duplicates.find((d) => d.document)?.document ?? null;

  if (donor && !canonical.user_id) {
    await sequelize.query(`UPDATE contacts SET user_id = NULL WHERE id = :id`, {
      replacements: { id: donor.id },
      transaction,
    });
  }

  await sequelize.query(
    `
    UPDATE contacts
    SET name = COALESCE(:realName, name),
        document = COALESCE(document, :document),
        user_id = COALESCE(user_id, :userId),
        updated_at = NOW()
    WHERE id = :canonicalId
    `,
    {
      replacements: {
        canonicalId: canonical.id,
        realName,
        document,
        userId: !canonical.user_id ? donor?.user_id ?? null : null,
      },
      transaction,
    },
  );

  await sequelize.query(`DELETE FROM contacts WHERE id IN (:duplicateIds)`, {
    replacements: { duplicateIds },
    transaction,
  });
}

async function main() {
  await sequelize.authenticate();

  const rows = await findDuplicateSellers();
  const groups = new Map<string, SellerRow[]>();
  for (const row of rows) {
    const key = `${row.integrations_id}:${row.id_system}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  console.log(`[MERGE_SELLERS] ${groups.size} grupo(s) duplicado(s)${DRY_RUN ? " (DRY_RUN)" : ""}`);

  let merged = 0;
  let skipped = 0;

  for (const group of groups.values()) {
    const canonical = pickCanonical(group);
    const duplicates = group.filter((s) => s.id !== canonical.id);
    const duplicateIds = duplicates.map((d) => d.id);

    console.log(
      `\n[MERGE_SELLERS] id_system=${canonical.id_system} → canônico "${canonical.name}" (${canonical.id}, mapping=${canonical.has_mapping})`,
    );
    for (const d of duplicates) {
      console.log(`  - duplicado "${d.name}" (${d.id}, pedidos=${d.orders_count})`);
    }
    console.log(`  referências a mover:`, await countReferences(duplicateIds));

    const conflicts = await findFactConflicts(canonical.id, duplicateIds);
    if (conflicts.length) {
      console.warn(`  ⚠️  conflito de facts (${conflicts.join(", ")}) — grupo pulado, resolver manualmente`);
      skipped++;
      continue;
    }

    if (DRY_RUN) continue;

    await sequelize.transaction((transaction) => mergeGroup(canonical, duplicates, transaction));
    merged++;
    console.log(`  ✅ mesclado`);
  }

  console.log(`\n[MERGE_SELLERS] fim — mesclados=${merged} pulados=${skipped}`);
  await sequelize.close();
}

main().catch(async (error) => {
  console.error("[MERGE_SELLERS] Erro:", error);
  await sequelize.close();
  process.exit(1);
});
