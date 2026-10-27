// SQL desses helpers é só Postgres; o sequelize de teste é sqlite (cita com crase), então usa instância postgres sem conexão.
jest.mock("../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { invoiceRowAttributes } from "../repositories/query-objects/sales-invoiced-report.attributes";

describe("invoiceRowAttributes", () => {
  it("calcula total_expected pelos invoice_items no alias aninhado, não pela coluna VIRTUAL", () => {
    const attributes = invoiceRowAttributes() as unknown[];
    const totalExpected = attributes.find(
      (attr) => Array.isArray(attr) && attr[1] === "total_expected",
    ) as [{ val: string }, string];

    expect(attributes).not.toContain("total_expected");
    expect(totalExpected[0].val).toContain('"orderSnapshot->invoice"."id"');
    expect(totalExpected[0].val).toContain("SUM(quantity_expected)");
  });
});
