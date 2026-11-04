import {
  buildReport,
  returnProblems,
  saleProblems,
} from "../services/main/integration-problems-report/integration-problems-report.aggregation";
import { SaleMovementInvoiceRow } from "../models/integration-problems-report.types";
import { SalesReturnLineRow } from "../../sales-return-report/models/sales-return-report.types";

const invoice = (overrides: Partial<SaleMovementInvoiceRow> = {}): SaleMovementInvoiceRow => ({
  invoice_id: "inv-1",
  invoice_number: "1001",
  is_order_adjustment: false,
  movement_date: "2026-10-05",
  invoice_cancelled: false,
  has_return_invoice: false,
  has_return: false,
  return_invoice_number: null,
  order_id: "o1",
  order_number: "P1",
  ...overrides,
});

const returnLine = (overrides: Partial<SalesReturnLineRow> = {}): SalesReturnLineRow => ({
  movement_id: "m1",
  return_invoice_id: "ret-1",
  return_invoice_number: "500",
  return_date: "2026-10-07",
  sku: null,
  description: null,
  quantity: "1",
  total_value: "10",
  has_price: true,
  product_name: null,
  brand: null,
  sale_invoice_number: null,
  order_id: null,
  order_number_system: null,
  order_date: null,
  store_name: null,
  seller_name: null,
  customer_name: null,
  sales_channel: null,
  ...overrides,
});

describe("saleProblems", () => {
  it("só os problemas de nota/Kardex; venda ok e cancelada devolvida ficam fora", () => {
    const rows = saleProblems(
      [
        invoice(),
        invoice({ invoice_number: "1002", invoice_cancelled: true, has_return_invoice: true, has_return: true }),
        invoice({ invoice_number: "1004", invoice_id: null }),
        invoice({ invoice_number: "1005", invoice_cancelled: true, has_return_invoice: true, return_invoice_number: "900" }),
        invoice({ invoice_number: "1006", invoice_cancelled: true }),
        invoice({ invoice_number: "1007", order_id: null, order_number: null }),
      ],
      [{ invoice_number: "1008", emitted_date: "2026-10-02", order_number: "P8" }],
    );

    expect(rows.map((row) => [row.problem, row.invoice_number])).toEqual([
      ["sale_movement_without_invoice", "1004"],
      ["cancelled_invoice_return_without_movement", "1005"],
      ["cancelled_invoice_without_return", "1006"],
      ["sale_invoice_without_order", "1007"],
      ["sale_invoice_without_movement", "1008"],
    ]);
    expect(rows[1].return_invoice_number).toBe("900");
    expect(rows[4]).toMatchObject({ date: "2026-10-02", order_number: "P8" });
    expect(rows[0].description).toBe("Saída no estoque com nota que não existe no sistema");
  });
});

describe("returnProblems", () => {
  it("movimento sem nota vira uma linha por número; NF sem movimento usa a emissão", () => {
    const rows = returnProblems(
      [
        returnLine(),
        returnLine({ movement_id: "m2", return_invoice_id: null, return_invoice_number: "777" }),
        returnLine({ movement_id: "m3", return_invoice_id: null, return_invoice_number: "777" }),
      ],
      [{ invoice_number: "600", emitted_date: "2026-10-09", xml_head: null }],
    );

    expect(rows.map((row) => [row.problem, row.invoice_number, row.date])).toEqual([
      ["return_movement_without_invoice", "777", "2026-10-07"],
      ["return_invoice_without_movement", "600", "2026-10-09"],
    ]);
  });
});

describe("buildReport", () => {
  it("ordena por problema e data e conta cada problema", () => {
    const rows = [
      ...returnProblems([], [{ invoice_number: "600", emitted_date: "2026-10-09", xml_head: null }]),
      ...saleProblems(
        [
          invoice({ invoice_number: "1007", order_id: null, movement_date: "2026-10-08" }),
          invoice({ invoice_number: "1006", order_id: null, movement_date: "2026-10-01" }),
        ],
        [],
      ),
    ];
    const report = buildReport(rows);

    expect(report.rows.map((row) => row.invoice_number)).toEqual(["1006", "1007", "600"]);
    expect(report.summary).toMatchObject({
      sale_invoice_without_order: 2,
      return_invoice_without_movement: 1,
      sale_movement_without_invoice: 0,
      total: 3,
    });
  });
});
