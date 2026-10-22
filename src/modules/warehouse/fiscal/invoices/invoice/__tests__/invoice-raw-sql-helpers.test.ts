// SQL desses helpers é só Postgres; o sequelize de teste é sqlite, então usa instância postgres sem conexão.
jest.mock("../../../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { Op } from "sequelize";
import { totalExpectedLiteral, totalReadLiteral } from "../helpers/totals";
import { productRimWhere } from "../helpers/custom-filters";
import { xmlHeadLiteral } from "../helpers/nfe-ide";
import { deliveryNoteGeneratedLiteral } from "../helpers/delivery-note";

const UB = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";
const RIM = "a00991ad-f288-4c77-9fb2-135c1e52ab6f";
const sql = (literal: any): string => literal.val;

describe("invoice helpers — SQL cru", () => {
  it("totalReadLiteral: unitBusinessId válido gera o mesmo SQL de antes", () => {
    const text = sql(totalReadLiteral(UB));
    expect(text).toContain(`WHERE ebi.invoice_id = "Invoice"."id"`);
    expect(text).toContain(`AND eb.unit_business_id = '${UB}'`);
  });

  it("totalReadLiteral: unitBusinessId do request com SQL fica escapado", () => {
    const text = sql(totalReadLiteral(`${UB}' OR '1'='1`));
    expect(text).toContain(`AND eb.unit_business_id = '${UB}'' OR ''1''=''1'`);
  });

  it("totalExpectedLiteral/xmlHeadLiteral/deliveryNote: alias citado, inclusive aninhado", () => {
    expect(sql(totalExpectedLiteral("orderSnapshot->invoice"))).toContain(
      `invoice_items.invoice_id = "orderSnapshot->invoice"."id"`,
    );
    expect(sql(xmlHeadLiteral())).toMatch(/^LEFT\("Invoice"\."xml_path", \d+\)$/);
    expect(sql(deliveryNoteGeneratedLiteral())).toContain(
      `ub.cnpj IN ("Invoice"."sender_cnpj", "Invoice"."receiver_cnpj")`,
    );
  });

  it("productRimWhere: uuid válido entra escapado, lixo do request é descartado", () => {
    const valid = sql((productRimWhere([RIM]) as any)[Op.and][0]);
    expect(valid).toContain(`p.rim_id = ANY(ARRAY['${RIM}']::uuid[])`);
    const injected = sql((productRimWhere(["x' OR '1'='1"]) as any)[Op.and][0]);
    expect(injected).toContain("p.rim_id = ANY(ARRAY[]::uuid[])");
  });
});
