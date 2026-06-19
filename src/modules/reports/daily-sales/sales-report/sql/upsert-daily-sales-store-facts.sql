-- upsert-daily-sales-store-facts.sql
--
-- Upsert do fact diário agregado por (fact_date, unit_business_id, store_id).
--
-- Parâmetros:
--   :factDate        -> date
--   :unitBusinessId   -> uuid
--   :storeId          -> uuid

WITH metrics AS (
  SELECT
    CAST(:factDate AS date)           AS fact_date,
    CAST(:unitBusinessId AS uuid)     AS unit_business_id,
    CAST(:storeId AS uuid)            AS store_id,
    COUNT(*)::integer                 AS orders_count,
    COALESCE(SUM(items_quantity),  0) AS items_quantity,
    COALESCE(SUM(total_order),     0) AS total_value,
    COALESCE(SUM(freight_charged), 0) AS total_freight,
    COALESCE(SUM(total_cost),      0) AS total_cost,
    COALESCE(SUM(total_taxes),     0) AS total_taxes,
    COALESCE(SUM(total_fees),      0) AS total_fees,
    COALESCE(SUM(contribution_value),0) AS contribution_value
  FROM sales_order_snapshots
  WHERE order_date       = CAST(:factDate AS date)
    AND unit_business_id = :unitBusinessId
    AND store_id         = :storeId
    AND snapshot_status IN ('open', 'completed')
)
INSERT INTO daily_sales_store_facts (
  fact_date, unit_business_id, store_id,
  orders_count, items_quantity, total_value, total_freight,
  average_ticket, total_cost, piece_average_value, markup_pct,
  total_taxes, total_fees, contribution_value, contribution_pct,
  last_updated_at, created_at, updated_at
)
SELECT
  fact_date, unit_business_id, store_id,
  orders_count, items_quantity, total_value, total_freight,
  CASE WHEN orders_count  = 0 THEN 0
    ELSE ROUND((total_value / orders_count)::numeric, 2) END,
  total_cost,
  CASE WHEN items_quantity = 0 THEN 0
    ELSE ROUND((total_value / items_quantity)::numeric, 2) END,
  CASE
    WHEN total_value = 0 THEN 0
    ELSE ROUND(
      ((total_value - total_cost) / NULLIF(total_value, 0) * 100)::numeric,
      2
    )
  END,
  total_taxes, total_fees, contribution_value,
  CASE WHEN total_value    = 0 THEN 0
    ELSE ROUND((contribution_value / total_value * 100)::numeric, 2) END,
  NOW(), NOW(), NOW()
FROM metrics
ON CONFLICT (fact_date, unit_business_id, store_id) DO UPDATE SET
  orders_count        = EXCLUDED.orders_count,
  items_quantity      = EXCLUDED.items_quantity,
  total_value         = EXCLUDED.total_value,
  total_freight       = EXCLUDED.total_freight,
  average_ticket      = EXCLUDED.average_ticket,
  total_cost          = EXCLUDED.total_cost,
  piece_average_value = EXCLUDED.piece_average_value,
  markup_pct          = EXCLUDED.markup_pct,
  total_taxes         = EXCLUDED.total_taxes,
  total_fees          = EXCLUDED.total_fees,
  contribution_value  = EXCLUDED.contribution_value,
  contribution_pct    = EXCLUDED.contribution_pct,
  last_updated_at     = NOW(),
  updated_at          = NOW()