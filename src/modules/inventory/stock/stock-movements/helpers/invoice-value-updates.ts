import { PurchaseEntryDiscountFields } from "./purchase-entry-discount";

export interface BulkSql {
  sql: string;
  replacements: Record<string, unknown>;
}

export interface InvoiceValueFill {
  id: string;
  unit_price_invoice: string | null;
  bling_entry_ids: string | null;
  bling_origin_id: string | null;
}

/**
 * UPDATE em lote (unnest) dos campos de desconto. `IS DISTINCT FROM` pula
 * linhas já corretas, então rodar de novo não escreve nada (idempotente).
 */
export function buildDiscountBulkUpdate(
  rows: PurchaseEntryDiscountFields[],
): BulkSql {
  return {
    sql: `
      UPDATE stock_movements AS sm
      SET gross_total_amount = v.gross,
          net_total_amount = v.net,
          unit_discount_amount = v.unit_discount,
          discount_amount = v.discount,
          discount_percentage = v.pct
      FROM unnest(
        ARRAY[:ids]::uuid[],
        ARRAY[:gross]::numeric[],
        ARRAY[:net]::numeric[],
        ARRAY[:unitDiscount]::numeric[],
        ARRAY[:discount]::numeric[],
        ARRAY[:pct]::numeric[]
      ) AS v(id, gross, net, unit_discount, discount, pct)
      WHERE sm.id = v.id
        AND (
          sm.gross_total_amount, sm.net_total_amount, sm.unit_discount_amount,
          sm.discount_amount, sm.discount_percentage
        ) IS DISTINCT FROM (v.gross, v.net, v.unit_discount, v.discount, v.pct)
    `,
    replacements: {
      ids: rows.map((r) => r.id),
      gross: rows.map((r) => r.gross_total_amount),
      net: rows.map((r) => r.net_total_amount),
      unitDiscount: rows.map((r) => r.unit_discount_amount),
      discount: rows.map((r) => r.discount_amount),
      pct: rows.map((r) => r.discount_percentage),
    },
  };
}

/**
 * Preenche só o que está NULL (COALESCE): reimportar nunca sobrescreve um
 * valor já gravado nem apaga com NULL.
 */
export function buildFillMissingInvoiceValuesUpdate(
  rows: InvoiceValueFill[],
): BulkSql {
  return {
    sql: `
      UPDATE stock_movements AS sm
      SET unit_price_invoice = COALESCE(sm.unit_price_invoice, v.price),
          bling_entry_ids = COALESCE(sm.bling_entry_ids, v.entry_ids),
          bling_origin_id = COALESCE(sm.bling_origin_id, v.origin_id)
      FROM unnest(
        ARRAY[:ids]::uuid[],
        ARRAY[:price]::numeric[],
        ARRAY[:entryIds]::text[],
        ARRAY[:originIds]::text[]
      ) AS v(id, price, entry_ids, origin_id)
      WHERE sm.id = v.id
        AND (
          (sm.unit_price_invoice IS NULL AND v.price IS NOT NULL)
          OR (sm.bling_entry_ids IS NULL AND v.entry_ids IS NOT NULL)
          OR (sm.bling_origin_id IS NULL AND v.origin_id IS NOT NULL)
        )
    `,
    replacements: {
      ids: rows.map((r) => r.id),
      price: rows.map((r) => r.unit_price_invoice),
      entryIds: rows.map((r) => r.bling_entry_ids),
      originIds: rows.map((r) => r.bling_origin_id),
    },
  };
}
