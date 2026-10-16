jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../../../modules/warehouse", () => ({
  __esModule: true,
  ExpeditionBatch: { findOne: jest.fn() },
}));

jest.mock("../../../../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../date", () => ({
  getBrazilDate: () => "16102026",
}));

import sequelize from "../../../../config/sequelize";
import { ExpeditionBatch } from "../../../../modules/warehouse";
import InventoryBatch from "../../../../modules/inventory/stock-inventory/inventory-batch/inventory-batch.model";
import { setBatchNumber } from "../batch-nomenclature";

const expeditionFindOne = ExpeditionBatch.findOne as jest.Mock;
const inventoryFindOne = InventoryBatch.findOne as jest.Mock;

// 1ª chamada de findOne = MAX da sequência; as seguintes = checagem de número existente.
const mockSequence = (findOne: jest.Mock, maxSequence: number | string | null, taken: string[] = []) => {
  findOne.mockImplementation(async (options: any) => {
    if (options.raw) return { max_sequence: maxSequence };
    return taken.includes(options.where.number) ? { id: "x" } : null;
  });
};

describe("setBatchNumber", () => {
  beforeEach(() => jest.clearAllMocks());

  it("usa a maior sequência + 1, mesmo quando um lote excluído deixou a contagem menor", async () => {
    // CD 17 já tem 0860; antes, count() = 859 após exclusão gerava 0860 de novo pra CD 12.
    mockSequence(expeditionFindOne, "860");

    const number = await setBatchNumber("EXPEDITION", "21", "ub-cd21", "LOGISTICA PAX PNEUS SP - CD 12");

    expect(number).toBe("LOGISTICA PAX PNEUS SP - CD 12_LOJA21_0861");
  });

  it("filtra o MAX pelo tipo do lote e pela unit business", async () => {
    mockSequence(expeditionFindOne, 3);

    await setBatchNumber("ENTRANCE", "21", "ub-cd21", "RODONAVES");

    expect(expeditionFindOne.mock.calls[0][0].where).toEqual({ type: "INCOMING", unit_business_id: "ub-cd21" });
  });

  it("começa em 0001 quando não há lote", async () => {
    mockSequence(expeditionFindOne, null);

    expect(await setBatchNumber("EXPEDITION", "21", "ub-cd21", "RODONAVES")).toBe("RODONAVES_LOJA21_0001");
  });

  it("pula número completo já usado (unique global da coluna number)", async () => {
    mockSequence(expeditionFindOne, 4, ["RODONAVES_LOJA21_0005"]);

    expect(await setBatchNumber("EXPEDITION", "21", "ub-cd21", "RODONAVES")).toBe("RODONAVES_LOJA21_0006");
  });

  it("pega o advisory lock por tipo + unit business quando há transação", async () => {
    mockSequence(expeditionFindOne, 0);
    const transaction = {} as any;

    await setBatchNumber("EXPEDITION", "21", "ub-cd21", "RODONAVES", transaction);

    expect(sequelize.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext(?))",
      { replacements: ["EXPEDITION:ub-cd21"], transaction },
    );
  });

  it("numera inventário e divergência pela maior sequência do próprio tipo", async () => {
    mockSequence(inventoryFindOne, 7);
    expect(await setBatchNumber("INVENTORY", "21", "ub-cd21")).toBe("INV_LOJA21_0008_16102026");
    expect(inventoryFindOne.mock.calls[0][0].where).toEqual({ unit_business_id: "ub-cd21", type: "REGULAR" });

    inventoryFindOne.mockClear();
    mockSequence(inventoryFindOne, 2);
    expect(await setBatchNumber("DIVERGENCY", "21", "ub-cd21")).toBe("DIV_LOJA21_0003_16102026");
    expect(inventoryFindOne.mock.calls[0][0].where).toEqual({ unit_business_id: "ub-cd21", type: "DIVERGENCY" });
  });
});
