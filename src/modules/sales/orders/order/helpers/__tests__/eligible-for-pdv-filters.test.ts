// SQL desses helpers é só Postgres; o sequelize de teste é sqlite (cita com crase), então usa instância postgres sem conexão.
jest.mock("../../../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import {
  orderWithoutIntegrationNumberWhenRequiredLiteral,
  pdvEligibilityLiterals,
} from "../eligible-for-pdv-filters";

describe("orderWithoutIntegrationNumberWhenRequiredLiteral", () => {
  it("só restringe a loja exigida e trata número vazio/'undefined' como sem integração", () => {
    const sql = (orderWithoutIntegrationNumberWhenRequiredLiteral("ub-site") as any).val;

    expect(sql).toContain(`"Order"."unit_business_id" IS DISTINCT FROM 'ub-site'`);
    expect(sql).toContain(
      `COALESCE(NULLIF(TRIM("Order"."number_order_channel"), ''), 'undefined') = 'undefined'`,
    );
  });
});

describe("pdvEligibilityLiterals", () => {
  it("com a loja do site: romaneio + vendedor + sem número de integração", () => {
    expect(pdvEligibilityLiterals("ub-site")).toHaveLength(3);
  });

  it("sem loja exigida: só o literal de romaneio", () => {
    expect(pdvEligibilityLiterals(null)).toHaveLength(1);
  });
});
