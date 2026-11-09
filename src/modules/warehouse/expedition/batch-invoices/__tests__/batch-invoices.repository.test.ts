// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.
import { Op } from "sequelize";
import ExpeditionBatchInvoice from "../batch-invoices.model";
import batchInvoicesRepository from "../batch-invoices.repository";

// Valores do enum enum_expedition_batches_status no banco: status fora dele quebra a query no Postgres.
const DB_BATCH_STATUSES = ["OPEN", "PENDING", "FINISHED"];

describe("ExpeditionBatchInvoiceRepository.findOpenIdsByInvoiceId", () => {
  it("lote aberto = status diferente de FINISHED, sem citar status que o enum do banco não tem", async () => {
    (ExpeditionBatchInvoice.findAll as jest.Mock).mockResolvedValue([{ id: "bi-1" }, { id: "bi-2" }]);

    await expect(batchInvoicesRepository.findOpenIdsByInvoiceId("inv-1")).resolves.toEqual(["bi-1", "bi-2"]);

    const statusWhere = (ExpeditionBatchInvoice.findAll as jest.Mock).mock.calls[0][0].include[0].where.status;
    expect(statusWhere).toEqual({ [Op.ne]: "FINISHED" });
    const cited = [statusWhere[Op.ne], statusWhere[Op.notIn], statusWhere[Op.in]].flat().filter(Boolean);
    expect(cited.every((s: string) => DB_BATCH_STATUSES.includes(s))).toBe(true);
  });
});
