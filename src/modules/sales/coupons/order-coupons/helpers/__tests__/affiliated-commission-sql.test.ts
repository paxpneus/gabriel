// SQL do helper é só Postgres; o sequelize de teste é sqlite (cita com crase), então usa instância postgres sem conexão.
jest.mock("../../../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { orderAffiliateJoinSql } from "../affiliated-commission-sql";

describe("orderAffiliateJoinSql", () => {
  it("cita os aliases do pedido e do lateral", () => {
    const sql = orderAffiliateJoinSql("o", "oa");

    expect(sql).toContain(`WHERE oc.order_id = "o".id`);
    expect(sql).toMatch(/\) "oa" ON TRUE$/);
    expect(sql).toContain("JOIN contact_coupons cc ON cc.id = oc.contact_coupon_id");
  });

  it("não filtra active (histórico congelado)", () => {
    expect(orderAffiliateJoinSql("ord", "oa")).not.toContain("active");
  });
});
