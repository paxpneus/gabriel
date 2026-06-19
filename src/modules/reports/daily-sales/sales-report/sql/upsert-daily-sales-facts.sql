-- upsert-daily-sales-facts.sql
--
-- Upsert do fact diário agregado por (fact_date, unit_business_id).
--
-- Parâmetros:
--   :factDate        -> date
--   :unitBusinessId   -> uuid

WITH metrics AS (
  SELECT
    CAST(:factDate AS date)        AS fact_date,
    CAST(:unitBusinessId AS uuid)  AS unit_business_id,
    COUNT(*)::integer              AS orders_count,
    COALESCE(SUM(items_quantity),    0) AS items_quantity,
    COALESCE(SUM(total_order),       0) AS total_value,
    COALESCE(SUM(freight_charged),   0) AS total_freight,
    COALESCE(SUM(total_cost),        0) AS total_cost,
    COALESCE(SUM(total_taxes),       0) AS total_taxes,
    COALESCE(SUM(total_fees),        0) AS total_fees,
    COALESCE(SUM(contribution_value),0) AS contribution_value
  FROM sales_order_snapshots
  WHERE order_date       = CAST(:factDate AS date)
    AND unit_business_id = :unitBusinessId
    AND snapshot_status IN ('open', 'completed')
)
INSERT INTO daily_sales_facts (
  fact_date, unit_business_id,
  orders_count, items_quantity,
  total_value, total_freight, average_freight, average_ticket,
  total_cost, total_taxes, total_fees,
  contribution_value, contribution_pct, markup_pct,
  last_updated_at, created_at, updated_at
)
SELECT
  fact_date, unit_business_id,
  orders_count, items_quantity,
  total_value, total_freight,
  CASE WHEN orders_count = 0 THEN 0
    ELSE ROUND((total_freight / orders_count)::numeric, 2) END,
  CASE WHEN orders_count = 0 THEN 0
    ELSE ROUND((total_value  / orders_count)::numeric, 2) END,
  total_cost, total_taxes, total_fees,
  contribution_value,
  CASE WHEN total_value = 0 THEN 0
    ELSE ROUND((contribution_value / NULLIF(total_value, 0) * 100)::numeric, 2) END,
  CASE WHEN total_value = 0 THEN 0
    ELSE ROUND(((total_value - total_cost) / NULLIF(total_value, 0) * 100)::numeric, 2)
  END,
  NOW(), NOW(), NOW()
FROM metrics
ON CONFLICT (fact_date, unit_business_id) DO UPDATE SET
  orders_count       = EXCLUDED.orders_count,
  items_quantity      = EXCLUDED.items_quantity,
  total_value         = EXCLUDED.total_value,
  total_freight       = EXCLUDED.total_freight,
  average_freight     = EXCLUDED.average_freight,
  average_ticket      = EXCLUDED.average_ticket,
  total_cost          = EXCLUDED.total_cost,
  total_taxes         = EXCLUDED.total_taxes,
  total_fees          = EXCLUDED.total_fees,
  contribution_value  = EXCLUDED.contribution_value,
  contribution_pct    = EXCLUDED.contribution_pct,
  markup_pct          = EXCLUDED.markup_pct,
  last_updated_at     = NOW(),
  updated_at          = NOW()