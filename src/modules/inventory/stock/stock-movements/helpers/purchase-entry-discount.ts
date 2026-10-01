import {
  DECIMAL_SCALE,
  divScaled,
  formatScaled,
  mulScaled,
  rescale,
  toScaled,
} from "../../../../../shared/utils/normalizers/decimal";

// Kardex já ordenado (movement_date, created_at, id) de UM produto/unit_business.
export interface DiscountHistoryRow {
  id: string;
  movement_type: string;
  direction?: string | null;
  invoice_number?: string | null;
  refers_to?: string | null;
  movement_quantity: string | number;
  unit_cost_invoice?: string | number | null;
  balance_quantity: string | number;
  resulting_average_cost: string | number;
  total_stock_value: string | number;
}

export interface PurchaseEntryDiscountFields {
  id: string;
  gross_total_amount: string | null;
  net_total_amount: string | null;
  unit_discount_amount: string | null;
  discount_amount: string | null;
  discount_percentage: string | null;
}

export type DiscountAnomalyKind =
  | "multiple_adjustments"
  | "non_adjacent_adjustment"
  | "adjustment_with_quantity"
  | "negative_discount"
  | "negative_previous_balance"
  | "missing_unit_cost"
  | "percentage_out_of_range";

export interface DiscountAnomaly {
  id: string;
  invoice_number: string | null;
  kind: DiscountAnomalyKind;
}

export interface PurchaseEntryDiscountResult {
  updates: PurchaseEntryDiscountFields[];
  withAdjustment: number;
  withoutAdjustment: number;
  anomalies: DiscountAnomaly[];
}

// DECIMAL(5,2) só comporta até 999.99.
const PERCENTAGE_LIMIT = 100000n; // 1000.00 na escala 2
const PERCENTAGE_SCALE = 2;

const ZERO = 0n;
const HUNDRED = 100n * 10n ** BigInt(DECIMAL_SCALE);

function scaled(value: string | number | null | undefined): bigint {
  return toScaled(value) ?? ZERO;
}

function signedQuantity(row: DiscountHistoryRow): bigint {
  const quantity = scaled(row.movement_quantity);
  return row.direction === "OUT" ? -quantity : quantity;
}

function emptyFields(id: string): PurchaseEntryDiscountFields {
  return {
    id,
    gross_total_amount: null,
    net_total_amount: null,
    unit_discount_amount: null,
    discount_amount: null,
    discount_percentage: null,
  };
}

/** MANUAL_ADJUSTMENT ancorados (refers_to = invoice_number) após a entrada, em ordem; vale o último. */
function findAnchoredAdjustments(
  history: DiscountHistoryRow[],
  entryIndex: number,
): { index: number; row: DiscountHistoryRow }[] {
  const entry = history[entryIndex];
  if (!entry.invoice_number) return [];

  const found: { index: number; row: DiscountHistoryRow }[] = [];
  for (let i = entryIndex + 1; i < history.length; i++) {
    const row = history[i];
    if (
      row.movement_type === "PURCHASE_ENTRY" &&
      row.invoice_number === entry.invoice_number
    ) {
      break;
    }
    if (
      row.movement_type === "MANUAL_ADJUSTMENT" &&
      row.refers_to === entry.invoice_number
    ) {
      found.push({ index: i, row });
    }
  }
  return found;
}

/** Desconto de cada PURCHASE_ENTRY a partir do Kardex ordenado; regras em .claude/entities/stock-movement.md. */
export function computePurchaseEntryDiscounts(
  history: DiscountHistoryRow[],
): PurchaseEntryDiscountResult {
  const updates: PurchaseEntryDiscountFields[] = [];
  const anomalies: DiscountAnomaly[] = [];
  let withAdjustment = 0;
  let withoutAdjustment = 0;

  history.forEach((entry, entryIndex) => {
    if (entry.movement_type !== "PURCHASE_ENTRY") return;

    const flag = (kind: DiscountAnomalyKind) =>
      anomalies.push({
        id: entry.id,
        invoice_number: entry.invoice_number ?? null,
        kind,
      });

    const unitCost = toScaled(entry.unit_cost_invoice);
    if (unitCost === null) {
      flag("missing_unit_cost");
      updates.push(emptyFields(entry.id));
      return;
    }

    const quantity = scaled(entry.movement_quantity);
    const previous = entryIndex > 0 ? history[entryIndex - 1] : null;
    const preValue = previous ? scaled(previous.total_stock_value) : ZERO;
    if (previous && scaled(previous.balance_quantity) < ZERO) {
      flag("negative_previous_balance");
    }

    const gross = mulScaled(quantity, unitCost);

    const adjustments = findAnchoredAdjustments(history, entryIndex);
    const adjustment = adjustments[adjustments.length - 1] ?? null;

    let net = gross;
    if (adjustment) {
      withAdjustment++;
      if (adjustments.length > 1) flag("multiple_adjustments");
      if (adjustment.index !== entryIndex + 1) flag("non_adjacent_adjustment");

      // Ajuste com quantidade: tira a parte da quantidade pra isolar só o efeito de custo.
      const adjustmentQuantity = scaled(adjustment.row.movement_quantity);
      if (adjustmentQuantity !== ZERO) flag("adjustment_with_quantity");
      const postValue =
        scaled(adjustment.row.total_stock_value) -
        mulScaled(
          signedQuantity(adjustment.row),
          scaled(adjustment.row.resulting_average_cost),
        );
      net = postValue - preValue;
    } else {
      withoutAdjustment++;
    }

    const discount = gross - net;
    if (discount < ZERO) flag("negative_discount");

    let unitDiscount: bigint | null = null;
    let percentage: bigint | null = null;

    if (quantity !== ZERO) {
      unitDiscount = unitCost - divScaled(net, quantity);
    }

    if (gross !== ZERO) {
      const pct = rescale(
        divScaled(mulScaled(discount, HUNDRED), gross),
        DECIMAL_SCALE,
        PERCENTAGE_SCALE,
      );
      const abs = pct < ZERO ? -pct : pct;
      if (abs >= PERCENTAGE_LIMIT) {
        flag("percentage_out_of_range");
      } else {
        percentage = pct;
      }
    }

    updates.push({
      id: entry.id,
      gross_total_amount: formatScaled(gross),
      net_total_amount: formatScaled(net),
      unit_discount_amount:
        unitDiscount === null ? null : formatScaled(unitDiscount),
      discount_amount: formatScaled(discount),
      discount_percentage:
        percentage === null ? null : formatScaled(percentage, PERCENTAGE_SCALE),
    });
  });

  return { updates, withAdjustment, withoutAdjustment, anomalies };
}
