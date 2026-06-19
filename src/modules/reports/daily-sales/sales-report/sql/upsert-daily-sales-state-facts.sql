-- upsert-daily-sales-state-facts.sql
--
-- Upsert do fact diário agregado por (fact_date, unit_business_id, destination_uf).
--
-- Parâmetros:
--   :factDate        -> date
--   :unitBusinessId   -> uuid
--   :destinationUf    -> varchar

WITH metrics AS (
  SELECT
    CAST(:factDate AS date)          AS fact_date,
    CAST(:unitBusinessId AS uuid)    AS unit_business_id,
    CAST(:destinationUf AS varchar)  AS destination_uf,
    COUNT(*)::integer                AS orders_count,
    COALESCE(SUM(items_quantity), 0) AS items_quantity,
    COALESCE(SUM(total_order),    0) AS total_value,
    COALESCE(SUM(freight_charged),0) AS total_freight
  FROM sales_order_snapshots
  WHERE order_date       = CAST(:factDate AS date)
    AND unit_business_id = :unitBusinessId
    AND destination_uf   = :destinationUf
    AND snapshot_status IN ('open', 'completed')
)
INSERT INTO daily_sales_state_facts (
  fact_date, unit_business_id, destination_uf,
  orders_count, items_quantity, total_value,
  total_freight, average_freight, average_ticket,
  last_updated_at, created_at, updated_at
)
SELECT
  fact_date, unit_business_id, destination_uf,
  orders_count, items_quantity, total_value,
  total_freight,
  CASE WHEN orders_count = 0 THEN 0
    ELSE ROUND((total_freight / orders_count)::numeric, 2) END,
  CASE WHEN orders_count = 0 THEN 0
    ELSE ROUND((total_value  / orders_count)::numeric, 2) END,
  NOW(), NOW(), NOW()
FROM metrics
ON CONFLICT (fact_date, unit_business_id, destination_uf) DO UPDATE SET
  orders_count    = EXCLUDED.orders_count,
  items_quantity  = EXCLUDED.items_quantity,
  total_value     = EXCLUDED.total_value,
  total_freight   = EXCLUDED.total_freight,
  average_freight = EXCLUDED.average_freight,
  average_ticket  = EXCLUDED.average_ticket,
  last_updated_at = NOW(),
  updated_at      = NOW()