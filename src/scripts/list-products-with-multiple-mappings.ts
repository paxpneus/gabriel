/**
 * list-products-with-multiple-mappings.ts
 *
 * Só leitura. Lista produtos com mais de um integration_mapping (PRODUCT) na mesma integração,
 * marcando qual ficou principal (is_primary) — pra revisar após o backfill do m323
 * (o não principal deixa de gravar preço/estoque/gtin no sync; estoque pode estar dividido entre os códigos).
 *
 * Uso:
 *   npx ts-node src/scripts/list-products-with-multiple-mappings.ts
 */

import { QueryTypes } from "sequelize";
import sequelize from "../config/sequelize";

interface Row {
  product_id: string;
  product_name: string;
  integration_name: string;
  external_id: string;
  is_primary: boolean;
  created_at: Date;
}

// Uma linha por mapping, agrupada por produto+integração na saída.
async function main(): Promise<void> {
  const rows = await sequelize.query<Row>(
    `
    SELECT p.id AS product_id, p.name AS product_name, i.name AS integration_name,
           im.external_id, im.is_primary, im.created_at
    FROM integration_mappings im
    JOIN products p ON p.id::text = im.internal_id
    JOIN integrations i ON i.id = im.integrations_id
    WHERE im.entity_type = 'PRODUCT'
      AND (im.internal_id, im.integrations_id) IN (
        SELECT internal_id, integrations_id
        FROM integration_mappings
        WHERE entity_type = 'PRODUCT'
        GROUP BY internal_id, integrations_id
        HAVING count(*) > 1
      )
    ORDER BY i.name, p.name, im.is_primary DESC, im.created_at ASC
    `,
    { type: QueryTypes.SELECT },
  );

  let currentKey = "";
  for (const row of rows) {
    const key = `${row.integration_name}|${row.product_id}`;
    if (key !== currentKey) {
      currentKey = key;
      console.log(`\n[${row.integration_name}] ${row.product_name} (${row.product_id})`);
    }
    console.log(
      `  ${row.is_primary ? "PRINCIPAL" : "leitura  "} external_id=${row.external_id} criado=${row.created_at.toISOString()}`,
    );
  }

  console.log(`\nTotal de mappings listados: ${rows.length}`);
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
