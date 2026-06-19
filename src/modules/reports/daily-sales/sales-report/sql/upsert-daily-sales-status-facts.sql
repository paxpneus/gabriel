-- upsert-daily-sales-status-facts.sql
--
-- Upsert do fact diário agregado por
-- (fact_date, unit_business_id, integration_id, status_normalized).
--
-- Parâmetros:
--   :factDate         -> date
--   :unitBusinessId    -> uuid
--   :integrationId     -> uuid
--   :statusNormalized  -> varchar

WITH metrics AS (
  SELECT
    CAST(:factDate AS date)            AS fact_date,
    CAST(:unitBusinessId AS uuid)      AS unit_business_id,
    CAST(:integrationId AS uuid)       AS integration_id,
    CAST(:statusNormalized AS varchar) AS status_normalized,
    COALESCE(
      MAX(iosm.display_name),
      :statusNormalized
    )                                  AS status_display_name,
    COUNT(sos.*)::integer              AS orders_count,
    COALESCE(SUM(sos.total_order), 0)  AS total_value
  FROM sales_order_snapshots sos
  LEFT JOIN integration_order_status_mappings iosm ON (
    iosm.integration_id    = sos.integration_id
    AND iosm.normalized_status = sos.status_snapshot
  )
  WHERE sos.order_date       = CAST(:factDate AS date)
    AND sos.unit_business_id = :unitBusinessId
    AND sos.integration_id   = :integrationId
    AND sos.status_snapshot  = :statusNormalized
)
INSERT INTO daily_sales_status_facts (
  fact_date, unit_business_id, integration_id,
  status_normalized, status_display_name,
  orders_count, total_value,
  last_updated_at, created_at, updated_at
)
SELECT
  fact_date, unit_business_id, integration_id,
  status_normalized, status_display_name,
  orders_count, total_value,
  NOW(), NOW(), NOW()
FROM metrics
ON CONFLICT (fact_date, unit_business_id, integration_id, status_normalized)
DO UPDATE SET
  status_display_name = EXCLUDED.status_display_name,
  orders_count         = EXCLUDED.orders_count,
  total_value          = EXCLUDED.total_value,
  last_updated_at      = NOW(),
  updated_at           = NOW()