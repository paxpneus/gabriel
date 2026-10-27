// SQL desses helpers é só Postgres; o sequelize de teste é sqlite (cita com crase), então usa instância postgres sem conexão.
jest.mock("../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { Op } from "sequelize";
import {
  saleTransferReportWhere,
  unitBusinessAttributesScopeWhere,
} from "../repositories/query-objects/sale-transfer-invoice-report.filters";
import { transferInvoiceColumnLiteral, transferInvoiceStatusLiteral } from "../repositories/query-objects/sale-transfer-invoice-report.attributes";

const UB = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";
const PRODUCT = "5ff76374-4d67-4ef3-a566-349a015f86b1";

describe("sale transfer invoice report filters", () => {
  it("escopa unitBusinessAttributes por loja e tipo", () => {
    expect(unitBusinessAttributesScopeWhere({ unitBusinessId: UB, type: "OUTGOING" })).toEqual({
      unit_business_id: UB,
      type: "OUTGOING",
    });
  });

  it("sem filtro próprio não restringe nada", () => {
    expect(saleTransferReportWhere({ originUnitBusinessIds: [], productIds: [] })).toEqual({
      [Op.and]: [],
    });
  });

  it("loja de origem vira IN e produto vira EXISTS em invoice_items", () => {
    const where = saleTransferReportWhere({
      originUnitBusinessIds: [UB],
      productIds: [PRODUCT],
    }) as any;
    const [origin, product] = where[Op.and];

    expect(origin).toEqual({ origin_unit_business_id: { [Op.in]: [UB] } });
    const productSql = product[Op.and][0].val;
    expect(productSql).toContain('ii.invoice_id = "Invoice"."id"');
    expect(productSql).toContain(`ii.product_id = ANY(ARRAY['${PRODUCT}']::uuid[])`);
  });

  it("id inválido não vaza pro SQL e não bate nada", () => {
    const where = saleTransferReportWhere({
      originUnitBusinessIds: ["x' OR 1=1 --"],
      productIds: ["nope"],
    }) as any;
    const [origin, product] = where[Op.and];

    expect(origin[Op.and][0].val).toBe("FALSE");
    expect(product[Op.and][0].val).toBe("FALSE");
  });

  it("número/emissão da transferência vêm da solicitação PDV mais recente da nota de venda", () => {
    expect((transferInvoiceColumnLiteral("emitted_at") as any).val).toContain("SELECT ti.emitted_at");
    const sql = (transferInvoiceColumnLiteral("number_system") as any).val;
    expect(sql).toContain("SELECT ti.number_system");
    expect(sql).toContain('psr.sale_invoice_id = "Invoice"."id"');
    expect(sql).toContain("JOIN invoices ti ON ti.id = psr.transfer_invoice_id");
    expect(sql).toContain("ORDER BY psr.created_at DESC");
  });

  it("status da transferência vem do attributes da loja emitente dela", () => {
    const sql = (transferInvoiceStatusLiteral() as any).val;
    expect(sql).toContain("JOIN unit_businesses ub ON ub.cnpj = ti.sender_cnpj");
    expect(sql).toContain("a.invoice_id = ti.id AND a.unit_business_id = ub.id");
    expect(sql).toContain('psr.sale_invoice_id = "Invoice"."id"');
  });
});
