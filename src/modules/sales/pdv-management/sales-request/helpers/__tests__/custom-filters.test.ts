// SQL desses helpers é só Postgres; o sequelize de teste é sqlite, então usa instância postgres sem conexão.
jest.mock("../../../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import {
  errorsReasonsOverlapLiteral,
  orderCustomerNameMatchesLiteral,
  orderDateWithinLiteral,
  orderNumberSystemMatchesLiteral,
  pdvSalesRequestSearchLiteral,
  saleInvoiceTransporterInLiteral,
} from "../custom-filters";
import { saleInvoiceTransporterCdExpression, transporterSelectorSql } from "../transporter-cd";
import { orderItemsQuantityLiteral } from "../status-summary";

const INJECTION = "x' OR '1'='1";
const TRANSPORTER = "a87369ac-dd81-4c18-b1c0-68b86768cc33";
const sql = (literal: any): string => literal.val;

describe("PDV custom-filters — valores do request no literal", () => {
  it.each([
    ["search", pdvSalesRequestSearchLiteral],
    ["number_order_system", orderNumberSystemMatchesLiteral],
    ["customer_name", orderCustomerNameMatchesLiteral],
  ])("%s: termo normal vira ILIKE '%%termo%%'", (_label, build) => {
    expect(sql(build("2198"))).toContain("ILIKE '%2198%'");
  });

  it.each([
    ["search", pdvSalesRequestSearchLiteral],
    ["number_order_system", orderNumberSystemMatchesLiteral],
    ["customer_name", orderCustomerNameMatchesLiteral],
  ])("%s: aspas do termo são escapadas, sem fechar a string", (_label, build) => {
    const text = sql(build(INJECTION));
    expect(text).toContain("ILIKE '%x'' OR ''1''=''1%'");
    expect(text).not.toContain("ILIKE '%x' OR");
  });

  it("date: só YYYY-MM-DD entra, escapado", () => {
    const text = sql(orderDateWithinLiteral({ start: "2026-10-01", end: "2026-10-06" }));
    expect(text).toContain("o.date >= '2026-10-01'::date");
    expect(text).toContain("o.date < ('2026-10-06'::date + INTERVAL '1 day')");
    expect(sql(orderDateWithinLiteral({ start: `2026-10-01' OR '1'='1` }))).not.toContain("OR '1'");
  });

  it("reason: cada valor vira string escapada no array do ?|", () => {
    expect(sql(errorsReasonsOverlapLiteral(["PAYMENT_RECEIPT", "PAYMENT_METHOD"]))).toBe(
      `("PdvSalesRequest"."errors" -> 'reasons') ?| array['PAYMENT_RECEIPT','PAYMENT_METHOD']`,
    );
    expect(sql(errorsReasonsOverlapLiteral(["A'] OR TRUE OR array['B"]))).toBe(
      `("PdvSalesRequest"."errors" -> 'reasons') ?| array['A''] OR TRUE OR array[''B']`,
    );
  });

  it("transporter_id: uuid válido entra escapado, inválido vira FALSE", () => {
    expect(sql(saleInvoiceTransporterInLiteral([TRANSPORTER]))).toContain(
      `i.transporter_id IN ('${TRANSPORTER}')`,
    );
    expect(sql(saleInvoiceTransporterInLiteral([INJECTION]))).toBe("FALSE");
    expect(transporterSelectorSql({ transporterId: INJECTION }, { name: "n", id: "i.id" })).toBe("FALSE");
    expect(transporterSelectorSql({ transporterId: TRANSPORTER }, { name: "n", id: "i.id" })).toBe(
      `i.id = '${TRANSPORTER}'`,
    );
  });
});

describe("PDV helpers — alias citado via quoteIdentifier", () => {
  it("default continua \"PdvSalesRequest\" (mesmo SQL de antes)", () => {
    expect(sql(orderItemsQuantityLiteral())).toContain(`oi.order_id = "PdvSalesRequest"."order_id"`);
    expect(sql(saleInvoiceTransporterCdExpression())).toContain(
      `i.id = "PdvSalesRequest"."sale_invoice_id"`,
    );
  });

  it("alias com aspas não fecha o identificador", () => {
    expect(sql(orderItemsQuantityLiteral(`x" OR 1=1 --`))).toContain(`"x OR 1=1 --"."order_id"`);
  });
});
