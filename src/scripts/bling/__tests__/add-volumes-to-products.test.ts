// src/scripts/bling/__tests__/add-volumes-to-products.test.ts

// ─── Mocks só pra cortar a cadeia de import ───────────────────────────────────
// O script importa blingApi/sequelize/setupAssociations no topo do arquivo.
// Isso arrasta uma cadeia pesada (bling_api.service → integrations.service →
// ...model → sequelize real), que tenta abrir conexão/dialect de verdade e
// quebra no Jest (ex: "Please install sqlite3 package manually").
//
// Esses mocks existem só pra evitar essa cadeia de import — NENHUM deles é
// usado nas asserções de computeVolumes/extractBlingProduct. Todo o
// comportamento testado usa putFn/getFn ou o retorno de sequelize.query
// mockados manualmente com dados fixos, não chamadas reais.

jest.mock("../../../modules/handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  blingApi: { get: jest.fn(), put: jest.fn() },
}));

jest.mock("../../../config/sequelize", () => ({
  __esModule: true,
  default: { authenticate: jest.fn(), query: jest.fn() },
}));

jest.mock("../../../config/sequelize-associations", () => ({
  __esModule: true,
  setupAssociations: jest.fn(),
}));

import sequelize from "../../../config/sequelize";
import {
  extractBlingProduct,
  computeVolumes,
  fetchFreshBlingProduct,
  fetchProductMappingsPage,
  updateVolumeInBling,
} from "../add-volumes-to-products"; // ajuste o path se necessário

// ─── Fixtures (baseadas nos payloads reais da Bling) ─────────────────────────

const unitProductPayload = {
  data: {
    id: 16210554961,
    nome: "Pneu 195/55R15 85H FR PowerContact 2 Continental",
    volumes: 0,
    estrutura: {
      tipoEstoque: "",
      lancamentoEstoque: "",
      componentes: [],
    },
  },
};

const kitProductPayload = {
  data: {
    id: 16679114658,
    nome: "Kit 4 Pneus 225/40r18 Continental Contisportcontact 5",
    volumes: 0,
    estrutura: {
      tipoEstoque: "V",
      lancamentoEstoque: "",
      componentes: [
        {
          produto: { id: 16210555131 },
          quantidade: 4,
        },
      ],
    },
  },
};

const kitMultiComponentPayload = {
  data: {
    id: 99999999999,
    nome: "Kit misto",
    volumes: 0,
    estrutura: {
      componentes: [
        { produto: { id: 1 }, quantidade: 2 },
        { produto: { id: 2 }, quantidade: 3 },
      ],
    },
  },
};

// Mapeamento fictício, no mesmo formato do exemplo real que você mandou
// (integration_mappings entity_type = 'PRODUCT')
const fakeMappingRow = {
  mapping_id: "00038b07-b067-47c3-a52f-e554b76dc373",
  internal_id: "428665ea-66b5-4e3c-b6e3-00471afc5b5b",
  external_id: "16210555464",
  source_payload: unitProductPayload,
  name: "Pneu 195/55R15 85H FR PowerContact 2 Continental",
};

// ─── extractBlingProduct ───────────────────────────────────────────────────────

describe("extractBlingProduct", () => {
  it("desembrulha o payload no formato { data: {...} } salvo pela Bling", () => {
    const result = extractBlingProduct(unitProductPayload);
    expect(result).toEqual(unitProductPayload.data);
  });

  it("aceita o objeto do produto já desembrulhado", () => {
    const result = extractBlingProduct(unitProductPayload.data);
    expect(result).toEqual(unitProductPayload.data);
  });

  it("retorna null quando o source_payload é null/undefined", () => {
    expect(extractBlingProduct(null)).toBeNull();
    expect(extractBlingProduct(undefined)).toBeNull();
  });
});

// ─── computeVolumes ─────────────────────────────────────────────────────────────

describe("computeVolumes", () => {
  it("retorna 1 para produto unitário (sem componentes)", () => {
    const blingProduct = extractBlingProduct(unitProductPayload);
    expect(computeVolumes(blingProduct)).toBe(1);
  });

  it("retorna a quantidade do componente para um kit com um componente", () => {
    const blingProduct = extractBlingProduct(kitProductPayload);
    expect(computeVolumes(blingProduct)).toBe(4);
  });

  it("soma as quantidades quando o kit tem múltiplos componentes", () => {
    const blingProduct = extractBlingProduct(kitMultiComponentPayload);
    expect(computeVolumes(blingProduct)).toBe(5);
  });

  it("retorna 1 quando estrutura.componentes não existe", () => {
    expect(computeVolumes({ nome: "Sem estrutura" })).toBe(1);
  });

  it("retorna 1 quando a soma das quantidades dá 0 (proteção contra volumes inválido)", () => {
    const blingProduct = {
      estrutura: { componentes: [{ produto: { id: 1 }, quantidade: 0 }] },
    };
    expect(computeVolumes(blingProduct)).toBe(1);
  });

  it("ignora quantidade inválida/NaN tratando como 0", () => {
    const blingProduct = {
      estrutura: {
        componentes: [{ produto: { id: 1 }, quantidade: "abc" as any }],
      },
    };
    expect(computeVolumes(blingProduct)).toBe(1);
  });
});

// ─── fetchProductMappingsPage ──────────────────────────────────────────────────
// sequelize.query é mockado com um retorno de dados fixo (fakeMappingRow) —
// não bate em banco nenhum, real ou de teste.

describe("fetchProductMappingsPage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passa integrationId/limit/offset como replacements pro sequelize.query", async () => {
    (sequelize.query as jest.Mock).mockResolvedValue([fakeMappingRow]);

    const result = await fetchProductMappingsPage(
      "9f2dad31-c321-42c0-9532-249847eb2a26",
      200,
      0,
    );

    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining("integration_mappings"),
      expect.objectContaining({
        replacements: {
          integrationId: "9f2dad31-c321-42c0-9532-249847eb2a26",
          limit: 200,
          offset: 0,
        },
      }),
    );
    expect(result).toEqual([fakeMappingRow]);
  });

  it("a query filtra entity_type = 'PRODUCT' e source_payload não nulo", async () => {
    (sequelize.query as jest.Mock).mockResolvedValue([]);

    await fetchProductMappingsPage("qualquer-uuid", 200, 0);

    const [sql] = (sequelize.query as jest.Mock).mock.calls[0];
    expect(sql).toEqual(expect.stringContaining("entity_type = 'PRODUCT'"));
    expect(sql).toEqual(
      expect.stringContaining("p.source_payload IS NOT NULL"),
    );
  });

  it("retorna array vazio quando não há mapeamentos pra essa integração", async () => {
    (sequelize.query as jest.Mock).mockResolvedValue([]);

    const result = await fetchProductMappingsPage("uuid-sem-mapeamentos", 200, 0);

    expect(result).toEqual([]);
  });
});

// ─── fetchFreshBlingProduct ─────────────────────────────────────────────────────
// Nenhuma chamada real à Bling — passamos uma getFn mockada (dado simulado).

describe("fetchFreshBlingProduct", () => {
  it("chama a getFn recebida e desembrulha o campo data", async () => {
    const getFn = jest.fn().mockResolvedValue({ data: kitProductPayload });

    const result = await fetchFreshBlingProduct(16679114658, getFn);

    expect(getFn).toHaveBeenCalledWith("/produtos/16679114658");
    expect(result).toEqual(kitProductPayload.data);
  });

  it("retorna o payload direto quando a resposta já vem sem wrapper 'data'", async () => {
    const getFn = jest.fn().mockResolvedValue({ data: kitProductPayload.data });

    const result = await fetchFreshBlingProduct(16679114658, getFn);

    expect(result).toEqual(kitProductPayload.data);
  });
});

// ─── updateVolumeInBling ────────────────────────────────────────────────────────
// putFn/getFn são apenas jest.fn() controladas no teste — dados mockados, sem
// nenhuma dependência do módulo real da Bling.

describe("updateVolumeInBling", () => {
  it("modo dry-run: não chama putFn nem getFn e retorna 'dry-run'", async () => {
    const putFn = jest.fn();
    const getFn = jest.fn();

    const strategy = await updateVolumeInBling(16210554961, 0, 1, {
      dryRun: true,
      putFn,
      getFn,
    });

    expect(strategy).toBe("dry-run");
    expect(putFn).not.toHaveBeenCalled();
    expect(getFn).not.toHaveBeenCalled();
  });

  it("busca o produto fresco na Bling e faz PUT completo com volumes sobrescrito", async () => {
    const putFn = jest.fn().mockResolvedValue({ status: 200 });
    const getFn = jest.fn().mockResolvedValue({ data: kitProductPayload });

    const strategy = await updateVolumeInBling(16679114658, 0, 4, {
      dryRun: false,
      putFn,
      getFn,
    });

    expect(strategy).toBe("full");
    expect(getFn).toHaveBeenCalledWith("/produtos/16679114658");
    expect(putFn).toHaveBeenCalledTimes(1);
    expect(putFn).toHaveBeenCalledWith("/produtos/16679114658", {
      ...kitProductPayload.data,
      volumes: 4,
    });
  });

  it("nunca reenvia o source_payload salvo no banco, só o payload fresco retornado por getFn", async () => {
    const staleDbPayload = { ...kitProductPayload.data, preco: 1 };
    const freshFromBling = { ...kitProductPayload.data, preco: 9999.13 };

    const putFn = jest.fn().mockResolvedValue({ status: 200 });
    const getFn = jest.fn().mockResolvedValue({ data: freshFromBling });

    await updateVolumeInBling(16679114658, 0, 4, {
      dryRun: false,
      putFn,
      getFn,
    });

    const body = putFn.mock.calls[0][1];
    expect(body.preco).toBe(9999.13);
    expect(body).not.toEqual(expect.objectContaining({ preco: staleDbPayload.preco }));
  });

  it("propaga erro se o PUT completo falhar", async () => {
    const putError = { response: { status: 422 }, message: "Unprocessable" };
    const putFn = jest.fn().mockRejectedValue(putError);
    const getFn = jest.fn().mockResolvedValue({ data: kitProductPayload });

    await expect(
      updateVolumeInBling(16210554961, 0, 1, { dryRun: false, putFn, getFn }),
    ).rejects.toEqual(putError);
  });
});