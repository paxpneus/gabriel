# Merging a duplicate product (manual SQL runbook)

Replace every reference to an OLD product with a NEW one, then delete OLD. No code/endpoint for this — user runs SQL by hand in prod psql (`docker exec -it autoinvoice_node-postgres-1 psql -U paxhub -d autointegration_node`). Claude only writes the SQL; user runs it and pastes output back.

## How to work with the user

- One table per step, each in its own `BEGIN; … COMMIT;`. User checks the output before `COMMIT`.
- Default is **only `product_id` changes** — no other column. Rules below are the exceptions the user already decided on (unique-key conflicts). Don't add extra merging (summing quantities, etc.).
- Wrap every block in a transaction. If any statement errors, psql leaves the transaction aborted (`=!#`) → `ROLLBACK;` first.
- `integration_mappings` sometimes the user fixes manually — ask/skip if they say so.

## Setup (psql variables, reused by every block below)

```sql
\set old_id 'OLD-UUID-HERE'
\set new_id 'NEW-UUID-HERE'
```

## Step 0 — discovery (read-only)

```sql
-- every column pointing at products (real FK or *product*id without FK), with row counts
WITH cols AS (
  SELECT DISTINCT c.oid::regclass::text AS tbl, a.attname::text AS col
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND a.attnum > 0 AND NOT a.attisdropped
    AND (a.attname LIKE '%product%id'
         OR EXISTS (SELECT 1 FROM pg_constraint k
                    WHERE k.contype = 'f' AND k.conrelid = a.attrelid
                      AND k.confrelid = 'products'::regclass
                      AND a.attnum = ANY (k.conkey)))
),
counts AS (
  SELECT tbl, col,
    (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s WHERE %I::text = %L',
      tbl, col, :'old_id'), false, true, '')))[1]::text::int AS old_rows,
    (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s WHERE %I::text = %L',
      tbl, col, :'new_id'), false, true, '')))[1]::text::int AS new_rows
  FROM cols
)
SELECT tbl, col, old_rows, new_rows FROM counts WHERE old_rows > 0 ORDER BY old_rows DESC;

-- integration_mappings has no FK (internal_id is varchar)
SELECT id, integrations_id, external_id,
       CASE WHEN internal_id = :'old_id' THEN 'OLD' ELSE 'NEW' END AS product
FROM integration_mappings
WHERE entity_type = 'PRODUCT' AND internal_id IN (:'old_id', :'new_id');

-- unique-key conflicts: same key already has a row for BOTH products
SELECT 'product_configs' AS tbl, unit_business_id::text AS key FROM product_configs
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'stocks', unit_business_id::text FROM stocks
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'invoice_items', invoice_id::text FROM invoice_items
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'invoice_fiscal_items', invoice_id::text FROM invoice_fiscal_items
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'inventory_batch_items', inventory_batch_id::text FROM inventory_batch_items
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'daily_seller_product_facts', fact_date::text || ' / ' || seller_id::text FROM daily_seller_product_facts
 WHERE product_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_id) = 2
UNION ALL
SELECT 'kit_components (kit)', product_component_id::text FROM kit_components
 WHERE product_kit_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_kit_id) = 2
UNION ALL
SELECT 'kit_components (component)', product_kit_id::text FROM kit_components
 WHERE product_component_id::text IN (:'old_id', :'new_id') GROUP BY 2 HAVING count(DISTINCT product_component_id) = 2;
```

Unique keys involving `product_id`: `product_configs (product_id, unit_business_id)`, `stocks (product_id, unit_business_id)`, `invoice_items (invoice_id, product_id)`, `invoice_fiscal_items (invoice_id, product_id)`, `inventory_batch_items (inventory_batch_id, product_id)`, `daily_seller_product_facts (fact_date, seller_id, product_id)`, `kit_components (product_kit_id, product_component_id)`. `product_supplier_maps` unique is `(integrations_id, supplier_product_code)` — no product_id.

## Order

1. Simple tables (no conflict) → 2. `product_configs` → 3. `product_supplier_maps` (must run **after** configs) → 4. `inventory_batch_items` → 5. `stocks` → 6. `integration_mappings` → 7. delete OLD.

## 1. Simple tables (any table from step 0 with no conflict)

`invoice_items`, `invoice_fiscal_items`, `expedition_batch_items`, `order_items`, `stock_movements`, report snapshots, etc. `batch_invoice_items` points at expedition item id, not product — untouched.

```sql
BEGIN;
UPDATE invoice_items        SET product_id = :'new_id' WHERE product_id = :'old_id';
UPDATE invoice_fiscal_items SET product_id = :'new_id' WHERE product_id = :'old_id';
-- repeat for each other table listed in step 0
COMMIT;
```

## 2. `product_configs`

User rule: OLD's configs in **non-Tecinco** unit businesses are deleted; configs in **Tecinco** unit businesses move to NEW. (In practice the conflicts so far were all non-Tecinco — e.g. `Loja 21 - CD MG` — so the delete removes them.)

GTIN trigger gotcha: `prevent_product_config_gtin_conflict` self-matches on a `product_id`-only UPDATE (see `config.md`) → move with `gtin = NULL`, then restore.

```sql
-- preview
SELECT pc.id, ub.name, i.name AS integration, pc.sku, pc.gtin,
       CASE WHEN i.name = 'Tecinco' THEN 'MOVE TO NEW' ELSE 'DELETE' END AS action
FROM product_configs pc
JOIN unit_businesses ub ON ub.id = pc.unit_business_id
LEFT JOIN integrations i ON i.id = ub.integrations_id
WHERE pc.product_id = :'old_id'
ORDER BY action, ub.name;

BEGIN;
DELETE FROM product_configs pc
USING unit_businesses ub
LEFT JOIN integrations i ON i.id = ub.integrations_id
WHERE pc.unit_business_id = ub.id
  AND pc.product_id = :'old_id'
  AND (i.name IS DISTINCT FROM 'Tecinco');

CREATE TEMP TABLE _gtins ON COMMIT DROP AS
SELECT id, gtin FROM product_configs WHERE product_id = :'old_id';

UPDATE product_configs SET product_id = :'new_id', gtin = NULL WHERE product_id = :'old_id';
UPDATE product_configs pc SET gtin = g.gtin FROM _gtins g WHERE pc.id = g.id AND g.gtin IS NOT NULL;

SELECT count(*) FROM product_configs WHERE product_id = :'old_id';  -- 0
-- COMMIT; / ROLLBACK;
```

If a Tecinco unit business still conflicts (NEW already has a config there), the UPDATE fails on unique key → ROLLBACK and ask the user which one stays. If the GTIN-restore UPDATE fails, a third product really owns that GTIN in that unit business.

## 3. `product_supplier_maps`

`prevent_supplier_mapping_gtin_conflict` fires on `product_id` change and compares the code with other products' config gtin/sku — that's why configs move first.

```sql
BEGIN;
UPDATE product_supplier_maps SET product_id = :'new_id' WHERE product_id = :'old_id';
COMMIT;
```

## 4. `inventory_batch_items`

User rule for batches where both products have an item: NEW's item keeps its id and receives OLD's data (sku, ean, quantities, divergencies, status, price — **not** `stock_id`); OLD's logs move to NEW's item; OLD's item is deleted. Other OLD items just swap `product_id`. Quantities are never recalculated/summed.

```sql
BEGIN;
CREATE TEMP TABLE _pairs ON COMMIT DROP AS
SELECT o.id AS old_item_id, n.id AS new_item_id
FROM inventory_batch_items o
JOIN inventory_batch_items n ON n.inventory_batch_id = o.inventory_batch_id AND n.product_id = :'new_id'
WHERE o.product_id = :'old_id';

-- check: if logs_new > 0 on an OPEN/PENDING batch, stop and ask (log sum would stop matching quantity_read)
SELECT p.*, b.status AS batch_status,
       (SELECT count(*) FROM inventory_batch_logs WHERE inventory_batch_item_id = p.old_item_id) AS logs_old,
       (SELECT count(*) FROM inventory_batch_logs WHERE inventory_batch_item_id = p.new_item_id) AS logs_new
FROM _pairs p
JOIN inventory_batch_items n ON n.id = p.new_item_id
JOIN inventory_batches b ON b.id = n.inventory_batch_id;

UPDATE inventory_batch_items n SET
  sku = o.sku, ean = o.ean,
  quantity_stock = o.quantity_stock, quantity_read = o.quantity_read,
  divergency = o.divergency, initial_divergency = o.initial_divergency,
  status = o.status, price = o.price
FROM _pairs p JOIN inventory_batch_items o ON o.id = p.old_item_id
WHERE n.id = p.new_item_id;

UPDATE inventory_batch_logs l SET inventory_batch_item_id = p.new_item_id
FROM _pairs p WHERE l.inventory_batch_item_id = p.old_item_id;

DELETE FROM inventory_batch_items WHERE id IN (SELECT old_item_id FROM _pairs);

UPDATE inventory_batch_items SET product_id = :'new_id' WHERE product_id = :'old_id';

SELECT count(*) FROM inventory_batch_items WHERE product_id = :'old_id';  -- 0
-- COMMIT; / ROLLBACK;
```

## 5. `stocks`

Only dependency on `stocks.id`: `inventory_batch_items.stock_id` (NOT NULL, FK `ON DELETE RESTRICT`; copied into re-count batches). Stocks are recreated/updated by the fetch, but a row can't be deleted while a batch item points to it.

User rule for unit businesses where both have a stock: NEW's row receives OLD's `quantity`/`total_price`, batch items are repointed, OLD's row deleted. Elsewhere: swap `product_id`.

```sql
BEGIN;
SELECT ub.name, o.id AS old_stock, o.quantity AS old_qty, o.total_price AS old_total,
       n.id AS new_stock, n.quantity AS new_qty, n.total_price AS new_total
FROM stocks o
JOIN stocks n ON n.unit_business_id = o.unit_business_id AND n.product_id = :'new_id'
JOIN unit_businesses ub ON ub.id = o.unit_business_id
WHERE o.product_id = :'old_id';

UPDATE stocks n SET quantity = o.quantity, total_price = o.total_price
FROM stocks o
WHERE o.product_id = :'old_id' AND n.product_id = :'new_id' AND n.unit_business_id = o.unit_business_id;

UPDATE inventory_batch_items ibi SET stock_id = n.id
FROM stocks o
JOIN stocks n ON n.unit_business_id = o.unit_business_id AND n.product_id = :'new_id'
WHERE ibi.stock_id = o.id AND o.product_id = :'old_id';

DELETE FROM stocks o USING stocks n
WHERE o.product_id = :'old_id' AND n.product_id = :'new_id' AND n.unit_business_id = o.unit_business_id;

UPDATE stocks SET product_id = :'new_id' WHERE product_id = :'old_id';

SELECT count(*) FROM stocks WHERE product_id = :'old_id';  -- 0
-- COMMIT; / ROLLBACK;
```

## 6. `integration_mappings`

Unique index is `(external_id, internal_id, entity_type, integrations_id)`. Must happen before step 7: `trigger_delete_integration_mapping_on_product_delete` deletes OLD's `PRODUCT` mappings when OLD is deleted.

```sql
BEGIN;
UPDATE integration_mappings SET internal_id = :'new_id'
WHERE entity_type = 'PRODUCT' AND internal_id = :'old_id';
COMMIT;
```

## 7. Delete OLD

Re-run step 0 first: discovery must return 0 rows and the mapping query must show only NEW.

```sql
BEGIN;
SELECT count(*) FROM integration_mappings WHERE entity_type = 'PRODUCT' AND internal_id = :'old_id';  -- 0
DELETE FROM products WHERE id = :'old_id';  -- DELETE 1
COMMIT;
```

If the DELETE hangs: FK checks seq-scan big tables whose index doesn't start with `product_id` (`invoice_items`, `invoice_fiscal_items`), or it's waiting on a lock. From another session:

```sql
SELECT pid, pg_blocking_pids(pid) AS blocked_by, state, wait_event_type, wait_event,
       now() - xact_start AS tx_age, left(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND (cardinality(pg_blocking_pids(pid)) > 0
       OR pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity));
```

## After

Report snapshots/facts (`sales_order_item_snapshots`, `daily_seller_product_facts`, `seller_sales_order_item_snapshots`) now point to NEW but aggregates aren't recomputed — reprocess the period if both products appear separately on the same day.
