-- upsert-order-snapshots.sql
--
-- Recalcula e grava os snapshots de pedido (sales_order_snapshots) e de item
-- (sales_order_item_snapshots) para os order_ids afetados, e atualiza os
-- campos derivados do pedido (custo, impostos, fees, contribuição, markup).
--
-- Fontes de alteração: apenas orders e order_items.
-- Stocks e products não disparam reprocessamento — o custo é congelado
-- no snapshot do momento da venda; backfill de custo histórico é comando separado.
--
-- Parâmetros:
--   :orderIds  -> uuid[] (array de order_id afetados)

WITH affected(order_id) AS (
  SELECT DISTINCT unnest(ARRAY[:orderIds]::uuid[])
),

-- ------------------------------------------------------------------
-- 1. Fonte de dados do pedido
-- ------------------------------------------------------------------
order_source AS (
  SELECT
    o.id                                                  AS order_id,
    o.integrations_id                                     AS integration_id,
    o.customer_id,
    o.store_id,
    o.unit_business_id,
    o.number_order_system                                 AS order_number_system,
    o.number_order_channel                                AS order_number_channel,
    DATE(COALESCE(o.date, o.created_at))                  AS order_date,
    o.destination_uf,
    o.destination_city,
    COALESCE(iosm.normalized_status, o.actual_situation)  AS status_snapshot,
    CASE
      WHEN COALESCE(iosm.is_cancelled, FALSE)             THEN 'cancelled'
      WHEN COALESCE(iosm.is_final, FALSE)
        OR o.internal_status::text = 'EMITTED'            THEN 'completed'
      ELSE 'open'
    END                                                   AS snapshot_status,
    COALESCE(o.total_products, o.total_price, 0)          AS total_products,
    COALESCE(o.total_order,    o.total_price, 0)          AS total_order,
    COALESCE(o.discount_value, 0)                         AS discount_value,
    COALESCE(o.other_expenses, 0)                         AS other_expenses,
    COALESCE(o.freight_charged, 0)                        AS freight_charged,
    COALESCE(o.freight_cost, 0)                           AS freight_cost,
    COALESCE(o.freight_by_account, 0)                     AS freight_by_account,
    COALESCE(o.tax_commission, 0)                         AS tax_commission,
    COALESCE(o.marketplace_fee, 0)                        AS marketplace_fee,
    COALESCE(o.payment_fee, 0)                            AS payment_fee,
    COALESCE(o.icms_value, 0)                             AS icms_value,
    COALESCE(o.ipi_value, 0)                              AS ipi_value,
    COALESCE(o.pis_value, 0)                              AS pis_value,
    COALESCE(o.cofins_value, 0)                           AS cofins_value,
    COALESCE(o.difal_value, 0)                            AS difal_value,
    COALESCE(o.ibs_value, 0)                              AS ibs_value,
    COALESCE(o.cbs_value, 0)                              AS cbs_value,
    ROUND(
      COALESCE(o.total_products, o.total_price, 0)
      * COALESCE(ubtc.approx_tax_rate, 0),
      2
    ) AS approx_tax_value,
    FALSE                                                 AS has_invoice_data,
    o.source_payload

  FROM orders o
  JOIN affected a ON a.order_id = o.id
  LEFT JOIN integration_order_status_mappings iosm ON (
    iosm.integration_id     = o.integrations_id
    AND iosm.external_status_id = o.actual_situation
  )
  LEFT JOIN unit_business_tax_configs ubtc
    ON ubtc.unit_business_id = o.unit_business_id
),

-- ------------------------------------------------------------------
-- 2. Upsert dos snapshots de pedido
--    RETURNING expande todos os campos necessários pelo item_source,
--    evitando joins com a tabela base dentro da mesma query CTE
--    (que não enxergaria rows recém-inseridos via DML CTE).
-- ------------------------------------------------------------------
inserted_orders AS (
  INSERT INTO sales_order_snapshots (
    order_id, integration_id, customer_id, store_id, unit_business_id,
    order_number_system, order_number_channel, order_date,
    destination_uf, destination_city, status_snapshot, snapshot_status,
    total_products, total_order, discount_value, other_expenses,
    freight_charged, freight_cost, freight_paid_by_company, freight_by_account,
    tax_commission, marketplace_fee, payment_fee,
    icms_value, ipi_value, pis_value, cofins_value, difal_value,
    ibs_value, cbs_value, approx_tax_value,
    has_invoice_data, source_payload,
    last_updated_at, created_at, updated_at
  )
  SELECT
    order_id, integration_id, customer_id, store_id, unit_business_id,
    order_number_system, order_number_channel, order_date,
    destination_uf, destination_city, status_snapshot, snapshot_status,
    total_products, total_order, discount_value, other_expenses,
    freight_charged, freight_cost,
    freight_cost > 0,
    freight_by_account,
    tax_commission, marketplace_fee, payment_fee,
    icms_value, ipi_value, pis_value, cofins_value, difal_value,
    ibs_value, cbs_value, approx_tax_value,
    has_invoice_data, source_payload,
    NOW(), NOW(), NOW()
  FROM order_source
  ON CONFLICT (order_id) DO UPDATE SET
    integration_id          = EXCLUDED.integration_id,
    customer_id             = EXCLUDED.customer_id,
    store_id                = EXCLUDED.store_id,
    unit_business_id        = EXCLUDED.unit_business_id,
    order_number_system     = EXCLUDED.order_number_system,
    order_number_channel    = EXCLUDED.order_number_channel,
    order_date              = EXCLUDED.order_date,
    destination_uf          = EXCLUDED.destination_uf,
    destination_city        = EXCLUDED.destination_city,
    status_snapshot         = EXCLUDED.status_snapshot,
    snapshot_status         = EXCLUDED.snapshot_status,
    total_products          = EXCLUDED.total_products,
    total_order             = EXCLUDED.total_order,
    discount_value          = EXCLUDED.discount_value,
    other_expenses          = EXCLUDED.other_expenses,
    freight_charged         = EXCLUDED.freight_charged,
    freight_cost            = EXCLUDED.freight_cost,
    freight_paid_by_company = EXCLUDED.freight_paid_by_company,
    freight_by_account      = EXCLUDED.freight_by_account,
    tax_commission          = EXCLUDED.tax_commission,
    marketplace_fee         = EXCLUDED.marketplace_fee,
    payment_fee             = EXCLUDED.payment_fee,
    icms_value              = EXCLUDED.icms_value,
    ipi_value               = EXCLUDED.ipi_value,
    pis_value               = EXCLUDED.pis_value,
    cofins_value            = EXCLUDED.cofins_value,
    difal_value             = EXCLUDED.difal_value,
    ibs_value               = EXCLUDED.ibs_value,
    cbs_value               = EXCLUDED.cbs_value,
    approx_tax_value        = EXCLUDED.approx_tax_value,
    has_invoice_data        = EXCLUDED.has_invoice_data,
    source_payload          = EXCLUDED.source_payload,
    last_updated_at         = NOW(),
    updated_at              = NOW()
  RETURNING
    id,
    order_id,
    store_id,
    unit_business_id,
    integration_id,
    order_date,
    destination_uf,
    total_order,
    freight_paid_by_company,
    freight_cost,
    icms_value,
    ipi_value,
    pis_value,
    cofins_value,
    difal_value,
    ibs_value,
    cbs_value,
    tax_commission,
    marketplace_fee,
    payment_fee
),

-- ------------------------------------------------------------------
-- 3. Fonte de dados dos itens
-- ------------------------------------------------------------------
item_source AS (
  SELECT
    io.id                                                 AS order_snapshot_id,
    oi.order_id,
    oi.id                                                 AS order_item_id,
    COALESCE(oi.product_id, p.id)                         AS product_id,
    io.store_id,
    io.unit_business_id,
    io.integration_id,
    io.order_date,
    io.destination_uf,
    COALESCE(pc.sku, oi.sku)                              AS sku,
    oi.name                                               AS description,
    oi.unit,
    COALESCE(oi.quantity, 0)::numeric                     AS quantity,
    COALESCE(oi.unit_price, oi.price, 0)::numeric         AS unit_price,
    COALESCE(
      oi.gross_total,
      COALESCE(oi.unit_price, oi.price, 0)::numeric
        * COALESCE(oi.quantity, 0)::numeric
    )                                                     AS gross_total,
    COALESCE(oi.discount_value, 0)                        AS discount_value,
    COALESCE(
      oi.net_total,
      (COALESCE(oi.unit_price, oi.price, 0)::numeric
        * COALESCE(oi.quantity, 0)::numeric)
        - COALESCE(oi.discount_value, 0)
    )                                                     AS net_total,
    CASE
      WHEN pc.supplier_cost_price IS NOT NULL
        THEN pc.supplier_cost_price
      WHEN st.quantity > 0
        THEN ROUND((st.total_price::numeric / st.quantity::numeric), 4)
      ELSE 0
    END                                                   AS average_cost_snapshot,
    CASE
      WHEN pc.supplier_cost_price IS NOT NULL THEN 'PRODUCT_CONFIG_COST'
      WHEN st.quantity > 0                    THEN 'STOCK_AVERAGE'
      ELSE 'UNKNOWN'
    END                                                   AS cost_source,
    COALESCE(oi.commission_base, 0)                       AS commission_base,
    COALESCE(oi.commission_rate, 0)                       AS commission_rate,
    COALESCE(oi.commission_value, 0)                      AS commission_value,
    pc.ncm                                                AS ncm,
    pc.cest                                               AS cest,
    NULL::varchar                                         AS cfop,
    COALESCE(pc.gtin, p.ean)                              AS gtin,
    0::numeric                                            AS approx_tax_value,
    0::numeric                                            AS icms_rate,
    0::numeric                                            AS icms_value,
    0::numeric                                            AS ipi_value,
    0::numeric                                            AS pis_value,
    0::numeric                                            AS cofins_value,
    0::numeric                                            AS difal_value,
    0::numeric                                            AS ibs_value,
    0::numeric                                            AS cbs_value,
    oi.source_payload
  FROM order_items oi
  JOIN inserted_orders io ON io.order_id = oi.order_id

  -- tenta resolver pelo sku quando não há product_id no item
  LEFT JOIN product_configs pc_by_sku ON (
    oi.product_id IS NULL
    AND pc_by_sku.sku = oi.sku
    AND pc_by_sku.unit_business_id = io.unit_business_id
  )

  -- produto resolvido por id direto ou via pc_by_sku
  LEFT JOIN products p ON (
    p.id = oi.product_id
    OR p.id = pc_by_sku.product_id
  )

  -- product_config definitivo para custo, preço, ncm, gtin etc.
  LEFT JOIN product_configs pc ON (
    pc.product_id = COALESCE(oi.product_id, p.id)
    AND pc.unit_business_id = io.unit_business_id
  )

  LEFT JOIN LATERAL (
    SELECT s.total_price, s.quantity
    FROM stocks s
    WHERE s.product_id = COALESCE(oi.product_id, p.id)
      AND s.quantity > 0
    ORDER BY
      CASE WHEN s.unit_business_id = io.unit_business_id THEN 0 ELSE 1 END,
      s.updated_at DESC
    LIMIT 1
  ) st ON TRUE
),

-- ------------------------------------------------------------------
-- 4. Upsert dos snapshots de item
--    RETURNING expande os campos necessários para item_totals.
-- ------------------------------------------------------------------
inserted_items AS (
  INSERT INTO sales_order_item_snapshots (
    order_snapshot_id, order_id, order_item_id, product_id,
    store_id, unit_business_id, integration_id, order_date, destination_uf,
    sku, description, unit, quantity, unit_price, gross_total, discount_value,
    net_total, average_cost_snapshot, total_cost_snapshot, cost_source, markup_pct,
    commission_base, commission_rate, commission_value,
    ncm, cest, cfop, gtin,
    approx_tax_value, icms_rate, icms_value, ipi_value, pis_value,
    cofins_value, difal_value, ibs_value, cbs_value,
    source_payload, last_updated_at, created_at, updated_at
  )
  SELECT
    order_snapshot_id, order_id, order_item_id, product_id,
    store_id, unit_business_id, integration_id, order_date, destination_uf,
    sku, description, unit, quantity, unit_price, gross_total, discount_value,
    net_total, average_cost_snapshot,
    ROUND((average_cost_snapshot * quantity)::numeric, 2),
    cost_source,
    CASE
      WHEN (average_cost_snapshot * quantity) = 0 THEN 0
      ELSE ROUND(
        ((net_total - (average_cost_snapshot * quantity))
          / (average_cost_snapshot * quantity) * 100)::numeric, 2
      )
    END,
    commission_base, commission_rate, commission_value,
    ncm, cest, cfop, gtin,
    approx_tax_value, icms_rate, icms_value, ipi_value, pis_value,
    cofins_value, difal_value, ibs_value, cbs_value,
    source_payload, NOW(), NOW(), NOW()
  FROM item_source
  ON CONFLICT (order_item_id) DO UPDATE SET
    order_snapshot_id     = EXCLUDED.order_snapshot_id,
    product_id            = EXCLUDED.product_id,
    store_id              = EXCLUDED.store_id,
    unit_business_id      = EXCLUDED.unit_business_id,
    integration_id        = EXCLUDED.integration_id,
    order_date            = EXCLUDED.order_date,
    destination_uf        = EXCLUDED.destination_uf,
    sku                   = EXCLUDED.sku,
    description           = EXCLUDED.description,
    unit                  = EXCLUDED.unit,
    quantity              = EXCLUDED.quantity,
    unit_price            = EXCLUDED.unit_price,
    gross_total           = EXCLUDED.gross_total,
    discount_value        = EXCLUDED.discount_value,
    net_total             = EXCLUDED.net_total,
    average_cost_snapshot = EXCLUDED.average_cost_snapshot,
    total_cost_snapshot   = EXCLUDED.total_cost_snapshot,
    cost_source           = EXCLUDED.cost_source,
    markup_pct            = EXCLUDED.markup_pct,
    commission_base       = EXCLUDED.commission_base,
    commission_rate       = EXCLUDED.commission_rate,
    commission_value      = EXCLUDED.commission_value,
    ncm                   = EXCLUDED.ncm,
    cest                  = EXCLUDED.cest,
    cfop                  = EXCLUDED.cfop,
    gtin                  = EXCLUDED.gtin,
    approx_tax_value      = EXCLUDED.approx_tax_value,
    icms_rate             = EXCLUDED.icms_rate,
    icms_value            = EXCLUDED.icms_value,
    ipi_value             = EXCLUDED.ipi_value,
    pis_value             = EXCLUDED.pis_value,
    cofins_value          = EXCLUDED.cofins_value,
    difal_value           = EXCLUDED.difal_value,
    ibs_value             = EXCLUDED.ibs_value,
    cbs_value             = EXCLUDED.cbs_value,
    source_payload        = EXCLUDED.source_payload,
    last_updated_at       = NOW(),
    updated_at            = NOW()
  RETURNING
    order_snapshot_id,
    quantity,
    total_cost_snapshot,
    cost_source
),

-- ------------------------------------------------------------------
-- 5. Agrega totais dos itens via inserted_items (RETURNING)
-- ------------------------------------------------------------------
item_totals AS (
  SELECT
    ii.order_snapshot_id,
    SUM(ii.quantity)                                          AS items_quantity,
    SUM(ii.total_cost_snapshot)                               AS total_cost,
    BOOL_OR(ii.cost_source IS DISTINCT FROM 'STOCK_AVERAGE')   AS has_cost_fallback
  FROM inserted_items ii
  GROUP BY ii.order_snapshot_id
)

-- ------------------------------------------------------------------
-- 6. Atualiza campos derivados no snapshot do pedido
-- ------------------------------------------------------------------
UPDATE sales_order_snapshots sos
SET
  items_quantity    = COALESCE(it.items_quantity, 0),
  total_cost        = COALESCE(it.total_cost, 0),

  total_taxes       = COALESCE(sos.icms_value,   0)
                    + COALESCE(sos.ipi_value,    0)
                    + COALESCE(sos.pis_value,    0)
                    + COALESCE(sos.cofins_value, 0)
                    + COALESCE(sos.difal_value,  0)
                    + COALESCE(sos.ibs_value,    0)
                    + COALESCE(sos.cbs_value,    0)
                    + COALESCE(sos.approx_tax_value,0),

  total_fees        = COALESCE(sos.tax_commission,  0)
                    + COALESCE(sos.marketplace_fee, 0)
                    + COALESCE(sos.payment_fee,     0),

  contribution_value =
    COALESCE(sos.total_order, 0)
    - COALESCE(it.total_cost, 0)
    - CASE WHEN sos.freight_paid_by_company
        THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
    - COALESCE(sos.approx_tax_value, 0)
    - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
       + COALESCE(sos.payment_fee,     0)),

  contribution_pct  =
    CASE WHEN COALESCE(sos.total_order, 0) = 0 THEN 0
    ELSE ROUND(((
      COALESCE(sos.total_order, 0)
      - COALESCE(it.total_cost, 0)
      - CASE WHEN sos.freight_paid_by_company
          THEN COALESCE(sos.freight_cost, 0) ELSE 0 END
      - (  COALESCE(sos.icms_value,   0) + COALESCE(sos.ipi_value,    0)
         + COALESCE(sos.pis_value,    0) + COALESCE(sos.cofins_value, 0)
         + COALESCE(sos.difal_value,  0) + COALESCE(sos.ibs_value,    0)
         + COALESCE(sos.cbs_value,    0) + COALESCE(sos.approx_tax_value, 0))
      - (  COALESCE(sos.tax_commission,  0) + COALESCE(sos.marketplace_fee, 0)
         + COALESCE(sos.payment_fee,     0))
    ) / sos.total_order * 100)::numeric, 2)
    END,

  markup_pct =
    CASE
      WHEN COALESCE(sos.total_order, 0) = 0 THEN 0
      ELSE ROUND((
        (COALESCE(sos.total_order, 0) - COALESCE(it.total_cost, 0))
        / NULLIF(COALESCE(sos.total_order, 0), 0)
        * 100
      )::numeric, 2)
    END,

  has_cost_fallback = COALESCE(it.has_cost_fallback, FALSE),
  last_updated_at   = NOW(),
  updated_at        = NOW()

FROM item_totals it
WHERE sos.id = it.order_snapshot_id