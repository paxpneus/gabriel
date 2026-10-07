import { Op } from "sequelize";
import {
  INVOICED_STATUSES,
  invoicedReportWhere,
} from "../repositories/query-objects/sales-invoiced-report.filters";

describe("sales invoiced report filters", () => {
  it("só Atendido, Enviado e Entregue — Em aberto fica de fora", () => {
    expect([...INVOICED_STATUSES].sort()).toEqual(
      ["ATENDIDO", "ENTREGUE", "ENVIADO_TRANSPORTE"].sort(),
    );
    expect(INVOICED_STATUSES).not.toContain("EM_ABERTO");
  });

  it("combina integração, status, completed, custo completo e período", () => {
    const where = invoicedReportWhere("int-bling", "2026-05-01", "2026-05-31", "orderSnapshot") as any;
    const [integration, status, completed, completeCost, period] = where[Op.and];

    expect(integration).toEqual({ integration_id: "int-bling" });
    expect(status).toEqual({ status_snapshot: { [Op.in]: INVOICED_STATUSES } });
    expect(completed).toEqual({ snapshot_status: "completed" });
    expect(completeCost.val).toContain('cost_check.order_snapshot_id = "orderSnapshot"."id"');
    expect(completeCost.val).toContain("COALESCE(cost_check.average_cost_snapshot, 0) <= 0");
    expect(period).toEqual({ order_date: { [Op.between]: ["2026-05-01", "2026-05-31"] } });
  });
});
