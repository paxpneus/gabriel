import { Op } from "sequelize";
import { monthBucketLiteral } from "../sequelize-helpers/month-bucket";
import {
  inputMovementsWhere,
  outputMovementsWhere,
  unitBusinessPeriodWhere,
} from "../query-objects/stock-movements/stock-movement.filters";
import {
  missingNetAmountCount,
  missingUnitPriceCount,
  outputValueSum,
} from "../query-objects/stock-movements/stock-movement.attributes";

describe("monthBucketLiteral", () => {
  it("usa o timezone escapado e o alias informado", () => {
    const literal = monthBucketLiteral("movement_date", "America/Sao_Paulo", "StockMovement");

    expect((literal as any).val).toContain(
      `"StockMovement"."movement_date" AT TIME ZONE 'America/Sao_Paulo'`,
    );
    expect((literal as any).val).toContain("'YYYY-MM'");
  });

  it("escapa aspas no timezone (nunca interpola cru)", () => {
    const literal = monthBucketLiteral("movement_date", "x'; DROP TABLE y;--");

    expect((literal as any).val).not.toContain("x'; DROP");
  });
});

describe("stock movement filters", () => {
  it("entradas = só PURCHASE_ENTRY", () => {
    expect(inputMovementsWhere()).toEqual({ movement_type: "PURCHASE_ENTRY" });
  });

  it("saídas = SALE_OUT + ajuste OUT com invoice_number", () => {
    expect(outputMovementsWhere()).toEqual({
      [Op.or]: [
        { movement_type: "SALE_OUT" },
        {
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "OUT",
          invoice_number: { [Op.ne]: null },
        },
      ],
    });
  });

  it("período por unidade considera só movimentos ativos", () => {
    const start = new Date("2026-05-01T03:00:00Z");
    const end = new Date("2026-05-31T23:59:59Z");

    expect(unitBusinessPeriodWhere("ub", start, end)).toEqual({
      unit_business_id: "ub",
      is_active: true,
      movement_date: { [Op.between]: [start, end] },
    });
  });
});

describe("stock movement attributes", () => {
  it("usam o alias informado", () => {
    expect((outputValueSum("sm") as any).val).toContain(`"sm"."unit_price_invoice" * "sm"."movement_quantity"`);
    expect((missingUnitPriceCount("sm") as any).val).toContain(`"sm"."unit_price_invoice" IS NULL`);
    expect((missingNetAmountCount("sm") as any).val).toContain(`"sm"."net_total_amount" IS NULL`);
  });
});
