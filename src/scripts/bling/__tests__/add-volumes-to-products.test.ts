// src/__tests__/scripts/update-product-volumes.script.test.ts

// ─── Mocks só pra cortar a cadeia de import ───────────────────────────────────
// O script importa blingApi/Product/sequelize no topo do arquivo. Isso arrasta
// uma cadeia pesada (bling_api.service → integrations.service → ...model →
// sequelize real), que tenta abrir conexão/dialect de verdade e quebra no
// Jest (ex: "Please install sqlite3 package manually").
//
// Esses mocks existem só pra evitar essa cadeia de import — NENHUM deles é
// usado nas asserções dos testes abaixo. Todo o comportamento testado usa
// putFn/getFn injetadas manualmente com dados mockados, não essas mocks de
// módulo.

jest.mock("../../../modules/handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  blingApi: { get: jest.fn(), put: jest.fn() },
}));

jest.mock("../../../modules/inventory", () => ({
  __esModule: true,
  Product: { findAll: jest.fn() },
}));

jest.mock("../../../config/sequelize", () => ({
  __esModule: true,
  default: { authenticate: jest.fn() },
}));

jest.mock("../../../config/sequelize-associations", () => ({
  __esModule: true,
  setupAssociations: jest.fn(),
}));

import {
  extractBlingProduct,
  computeVolumes,
  fetchFreshBlingProduct,
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

  it("caminho feliz: PUT com { volumes } funciona de primeira e não busca nada antes", async () => {
    const putFn = jest.fn().mockResolvedValue({ status: 200 });
    const getFn = jest.fn();

    const strategy = await updateVolumeInBling(16210554961, 0, 1, {
      dryRun: false,
      autoFallback: true,
      putFn,
      getFn,
    });

    expect(strategy).toBe("minimal");
    expect(getFn).not.toHaveBeenCalled();
    expect(putFn).toHaveBeenCalledTimes(1);
    expect(putFn).toHaveBeenCalledWith("/produtos/16210554961", {
      volumes: 1,
    });
  });

  it("fallback: quando o PUT mínimo falha, busca o produto fresco (getFn) e reenvia completo", async () => {
    const putFn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 422 } }) // PUT mínimo falha
      .mockResolvedValueOnce({ status: 200 }); // PUT completo funciona
    const getFn = jest.fn().mockResolvedValue({ data: kitProductPayload });

    const strategy = await updateVolumeInBling(16679114658, 0, 4, {
      dryRun: false,
      autoFallback: true,
      putFn,
      getFn,
    });

    expect(strategy).toBe("full");

    // busca o produto fresco (nunca usa o source_payload do banco)
    expect(getFn).toHaveBeenCalledWith("/produtos/16679114658");

    // primeira tentativa: só volumes
    expect(putFn).toHaveBeenNthCalledWith(1, "/produtos/16679114658", {
      volumes: 4,
    });

    // segunda tentativa: payload fresco retornado por getFn + volumes sobrescrito
    expect(putFn).toHaveBeenNthCalledWith(2, "/produtos/16679114658", {
      ...kitProductPayload.data,
      volumes: 4,
    });
  });

  it("sem fallback (autoFallback: false): propaga o erro do PUT mínimo e não chama getFn", async () => {
    const putError = { response: { status: 422 }, message: "Unprocessable" };
    const putFn = jest.fn().mockRejectedValue(putError);
    const getFn = jest.fn();

    await expect(
      updateVolumeInBling(16210554961, 0, 1, {
        dryRun: false,
        autoFallback: false,
        putFn,
        getFn,
      }),
    ).rejects.toEqual(putError);

    expect(getFn).not.toHaveBeenCalled();
    expect(putFn).toHaveBeenCalledTimes(1);
  });

  it("fallback nunca reenvia o source_payload salvo no banco, só o payload fresco retornado por getFn", async () => {
    const staleDbPayload = {
      ...kitProductPayload.data,
      preco: 1, // valor propositalmente desatualizado, simulando o banco
    };
    const freshFromBling = { ...kitProductPayload.data, preco: 9999.13 };

    const putFn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 422 } })
      .mockResolvedValueOnce({ status: 200 });
    const getFn = jest.fn().mockResolvedValue({ data: freshFromBling });

    await updateVolumeInBling(16679114658, 0, 4, {
      dryRun: false,
      autoFallback: true,
      putFn,
      getFn,
    });

    const secondCallBody = putFn.mock.calls[1][1];

    // o body enviado tem que vir do getFn (dado "fresco" mockado), não do staleDbPayload
    expect(secondCallBody.preco).toBe(9999.13);
    expect(secondCallBody).not.toEqual(
      expect.objectContaining({ preco: staleDbPayload.preco }),
    );
  });
});