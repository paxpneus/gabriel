import { Op } from "sequelize";
import {
  completeCostSnapshotWhere,
  completedSnapshotWhere,
  snapshotIntegrationWhere,
  snapshotPeriodWhere,
  snapshotStatusWhere,
} from "../query-objects/sales-snapshots/sales-order-snapshot.filters";

describe("sales order snapshot filters", () => {
  it("período por order_date inclusivo", () => {
    expect(snapshotPeriodWhere("2026-05-01", "2026-05-31")).toEqual({
      order_date: { [Op.between]: ["2026-05-01", "2026-05-31"] },
    });
  });

  it("completed = não cancelado e com custo", () => {
    expect(completedSnapshotWhere()).toEqual({ snapshot_status: "completed" });
  });

  it("integração e status", () => {
    expect(snapshotIntegrationWhere("int-1")).toEqual({ integration_id: "int-1" });
    expect(snapshotStatusWhere(["ATENDIDO"])).toEqual({
      status_snapshot: { [Op.in]: ["ATENDIDO"] },
    });
  });

  it("custo completo confere os itens no alias informado", () => {
    const literal = completeCostSnapshotWhere("orderSnapshot") as any;
    expect(literal.val).toContain("NOT EXISTS");
    expect(literal.val).toContain('cost_check.order_snapshot_id = "orderSnapshot"."id"');
    expect(literal.val).toContain("COALESCE(cost_check.average_cost_snapshot, 0) <= 0");
  });
});
