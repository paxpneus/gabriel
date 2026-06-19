-- upsert-daily-sales-product-facts.sql
--
-- Upsert do fact diário agregado por (fact_date, unit_business_id, sku).
--
-- Parâmetros:
--   :factDate        -> date
--   :unitBusinessId   -> uuid
--   :sku              -> varchar

WITH metrics AS (
  SELECT
    CAST(:factDate AS date)           AS fact_date,
    CAST(:unitBusinessId AS uuid)     AS unit_business_id,
    (ARRAY_AGG(product_id) FILTER (WHERE product_id IS NOT NULL))[1] AS product_id,
    CAST(:sku AS varchar)             AS sku,
    MAX(description)                  AS description,
    COALESCE(SUM(quantity),           0) AS quantity,
    COALESCE(SUM(total_cost_snapshot),0) AS total_cost,
    COALESCE(SUM(net_total),          0) AS total_value
  FROM sales_order_item_snapshots sois
  JOIN sales_order_snapshots sos ON sos.id = sois.order_snapshot_id
  WHERE sois.order_date       = CAST(:factDate AS date)
    AND sois.unit_business_id = :unitBusinessId
    AND sois.sku              = :sku
    AND sos.snapshot_status IN ('open', 'completed')
)
INSERT INTO daily_sales_product_facts (
  fact_date, unit_business_id, product_id, sku, description,
  quantity, total_cost, total_value, markup_pct,
  last_updated_at, created_at, updated_at
)
SELECT
  fact_date, unit_business_id, product_id, sku, description,
  quantity, total_cost, total_value,
  CASE
    WHEN total_value = 0 THEN 0
    ELSE ROUND(
      ((total_value - total_cost) / NULLIF(total_value, 0) * 100)::numeric,
      2
    )
  END,
  NOW(), NOW(), NOW()
FROM metrics
ON CONFLICT (fact_date, unit_business_id, sku) DO UPDATE SET
  product_id      = EXCLUDED.product_id,
  description     = EXCLUDED.description,
  quantity        = EXCLUDED.quantity,
  total_cost      = EXCLUDED.total_cost,
  total_value     = EXCLUDED.total_value,
  markup_pct      = EXCLUDED.markup_pct,
  last_updated_at = NOW(),
  updated_at      = NOW()