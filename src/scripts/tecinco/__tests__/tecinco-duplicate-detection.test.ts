jest.mock("../dump-tecinco-catalog", () => ({
  __esModule: true,
  fetchTecincoCatalog: jest.fn(),
}));

// product.helpers.ts arrasta UnitBusiness/integrationMappingService (config
// real do Sequelize) só pra emprestar normalizeEan — mocka-se o módulo
// inteiro pra manter este teste isolado (mesmo motivo de outros mocks de
// infra na suíte do TCarUpsertQueue).
jest.mock("../../../modules/handlers/tecinco/queues/helpers/product.helpers", () => ({
  __esModule: true,
  normalizeEan: (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  },
}));

import { fetchTecincoCatalog, TecincoCatalogItem } from "../dump-tecinco-catalog";
import {
  getCachedTecincoDuplicateValueSets,
  setCachedTecincoDuplicateValueSets,
} from "../tecinco-duplicate-detection";

function makeItem(overrides: Partial<TecincoCatalogItem> = {}): TecincoCatalogItem {
  return {
    id_sistema: "1",
    sku: "SKU-1",
    coded: "1",
    ean: null,
    nome: "Produto",
    grupo: null,
    subgrupo: null,
    marca: null,
    ...overrides,
  };
}

describe("getCachedTecincoDuplicateValueSets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("chamadas concorrentes pra mesma branchIds com cache frio compartilham uma única busca (evita cache stampede)", async () => {
    let resolveCatalog: (items: TecincoCatalogItem[]) => void;
    (fetchTecincoCatalog as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );

    const branchIds = [901];
    const call1 = getCachedTecincoDuplicateValueSets(branchIds, "test");
    const call2 = getCachedTecincoDuplicateValueSets(branchIds, "test");
    const call3 = getCachedTecincoDuplicateValueSets(branchIds, "test");

    resolveCatalog!([makeItem({ sku: "DUP" }), makeItem({ id_sistema: "2", sku: "DUP" })]);
    const [sets1, sets2, sets3] = await Promise.all([call1, call2, call3]);

    expect(fetchTecincoCatalog).toHaveBeenCalledTimes(1);
    expect(sets1.sku.has("DUP")).toBe(true);
    expect(sets2).toBe(sets1);
    expect(sets3).toBe(sets1);
  });

  it("segunda chamada depois do cache pronto não busca de novo", async () => {
    (fetchTecincoCatalog as jest.Mock).mockResolvedValue([makeItem()]);
    const branchIds = [902];

    await getCachedTecincoDuplicateValueSets(branchIds, "test");
    await getCachedTecincoDuplicateValueSets(branchIds, "test");

    expect(fetchTecincoCatalog).toHaveBeenCalledTimes(1);
  });

  it("setCachedTecincoDuplicateValueSets popula o cache sem precisar buscar", async () => {
    const branchIds = [903];
    setCachedTecincoDuplicateValueSets(branchIds, {
      sku: new Set(["PRE-WARMED"]),
      ean: new Set(),
    });

    const sets = await getCachedTecincoDuplicateValueSets(branchIds, "test");

    expect(fetchTecincoCatalog).not.toHaveBeenCalled();
    expect(sets.sku.has("PRE-WARMED")).toBe(true);
  });
});
