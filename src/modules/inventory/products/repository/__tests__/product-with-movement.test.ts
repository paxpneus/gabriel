import { Op } from 'sequelize';
import { StockMovementRepository } from '../../../stock/stock-movements/stock-movements.repository';

// Mesma finalidade do mock de config/sequelize em contacts.service.test.ts:
// evita que a cadeia de imports (BaseRepository -> model -> sequelize) tente
// abrir conexão de verdade durante o teste.
jest.mock("../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb) => cb({})),
    where: jest.fn((col, val) => ({ col, val })),
    fn: jest.fn((fnName, ...args) => ({ fnName, args })),
    col: jest.fn((name) => name),
  },
}));


// ─── Helpers de mock (baseados no payload real fornecido) ────────────────────

const PRODUCT_ID = "f88bde21-efa6-4955-ba6e-d23bcb4f270c";
const UNIT_BUSINESS_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

// Movements do produto real, já no shape retornado pela query
// (order: movement_date ASC, created_at ASC — o que o repository espera
// receber do banco pra findLastPurchaseEntries).
const realProductMovementsAsc = [
  {
    id: "092f9bc8-1e76-4027-9702-207dc0ebb440",
    product_id: PRODUCT_ID,
    movement_type: "PURCHASE_ENTRY",
    movement_date: "2025-12-15T12:27:12.000Z",
    resulting_average_cost: "2841.2200",
    balance_quantity: "2.0000",
    manual_average_cost_value: null,
  },
  {
    id: "9680f150-a776-4bb2-a37e-bf50087ee051",
    product_id: PRODUCT_ID,
    movement_type: "MANUAL_ADJUSTMENT",
    direction: "OUT",
    movement_date: "2026-01-14T08:53:24.000Z",
    resulting_average_cost: "2841.2200",
    balance_quantity: "0.0000",
    manual_average_cost_value: null, // sem custo -> não é candidato a "entrada"
  },
  {
    id: "8cddd757-5199-4b74-86c4-06e8bc7a6ab8",
    product_id: PRODUCT_ID,
    movement_type: "PURCHASE_ENTRY",
    movement_date: "2026-07-09T18:05:57.000Z",
    resulting_average_cost: "2596.5875",
    balance_quantity: "4.0000",
    manual_average_cost_value: null,
  },
  {
    id: "42c7192a-897b-40b4-be2a-253c6089ce30",
    product_id: PRODUCT_ID,
    movement_type: "SALE_OUT",
    movement_date: "2026-07-22T17:12:07.000Z",
    resulting_average_cost: "2596.5875",
    balance_quantity: "2.0000",
    manual_average_cost_value: null,
  },
];

// Mesmos movimentos, mas na ordem DESC que findLastMovementsByProducts espera
// (movement_date DESC, created_at DESC).
const realProductMovementsDesc = [...realProductMovementsAsc].reverse();

function makeRepositoryWithMockedModel() {
  const repository = new StockMovementRepository();
  const findAll = jest.fn();
  (repository as any).model = { findAll };
  return { repository, findAll };
}

// ─── findLastPurchaseEntries ───────────────────────────────────────────────

describe("StockMovementRepository.findLastPurchaseEntries", () => {
  it("retorna vazio sem chamar o model quando productIds está vazio", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();

    const result = await repository.findLastPurchaseEntries(
      [],
      UNIT_BUSINESS_ID,
    );

    expect(result.size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("retorna as 2 últimas entradas efetivas do produto real, mais recente primeiro", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsAsc);

    const result = await repository.findLastPurchaseEntries(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
    );

    const entries = result.get(PRODUCT_ID);

    // O MANUAL_ADJUSTMENT sem custo (9680f150) não vira "entrada" nem
    // corrige nada — é ignorado. A SALE_OUT quebra a adjacência mas não
    // interfere no resultado porque não há ajuste depois dela.
    expect(entries).toHaveLength(2);
    expect(entries?.[0].id).toBe("8cddd757-5199-4b74-86c4-06e8bc7a6ab8"); // mais recente
    expect(entries?.[1].id).toBe("092f9bc8-1e76-4027-9702-207dc0ebb440"); // segunda
    expect(entries?.[0].resulting_average_cost).toBe("2596.5875");
    expect(entries?.[1].resulting_average_cost).toBe("2841.2200");
  });

  it("passa asOfDate como filtro movement_date <= asOfDate pro model", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue([]);
    const asOfDate = new Date("2026-07-10T00:00:00.000Z");

    await repository.findLastPurchaseEntries(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
      asOfDate,
    );

    const callArgs = findAll.mock.calls[0][0];
    expect(callArgs.where.movement_date).toBeDefined();
    expect(callArgs.where.is_active).toBe(true);
    expect(callArgs.where.unit_business_id).toBe(UNIT_BUSINESS_ID);
  });

  it("respeita o parâmetro limit (ex.: 3 em vez do default 2)", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsAsc);

    const result = await repository.findLastPurchaseEntries(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
      undefined,
      3,
    );

    // Só existem 2 PURCHASE_ENTRY na pilha (o MANUAL_ADJUSTMENT sem custo
    // não entra), então limit=3 não estoura o array, só não corta nada.
    expect(result.get(PRODUCT_ID)).toHaveLength(2);
  });

  describe("janela de 1 dia entre PURCHASE_ENTRY e MANUAL_ADJUSTMENT com custo", () => {
    it("MANUAL_ADJUSTMENT dentro de 1 dia substitui o topo mesmo com evento no meio", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "A-entry",
          product_id: "p1",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-01-01T00:00:00.000Z",
          resulting_average_cost: "100.00",
          manual_average_cost_value: null,
        },
        {
          id: "B-sale-in-between",
          product_id: "p1",
          movement_type: "SALE_OUT",
          movement_date: "2026-01-01T10:00:00.000Z",
          resulting_average_cost: "100.00",
          manual_average_cost_value: null,
        },
        {
          id: "C-manual-adjustment-close",
          product_id: "p1",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-01-01T20:00:00.000Z", // 20h depois de A, dentro da janela
          resulting_average_cost: "120.00",
          manual_average_cost_value: "120.00",
        },
        {
          id: "D-entry-2",
          product_id: "p1",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-01-10T00:00:00.000Z",
          resulting_average_cost: "200.00",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p1"],
        UNIT_BUSINESS_ID,
        undefined,
        3, // limit alto pra enxergar a pilha inteira e confirmar o merge
      );

      const entries = result.get("p1");

      // Pilha final deve ter só 2 itens (C substituiu A, D é entrada nova)
      // — se A e C aparecessem os dois, o merge não teria acontecido.
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual([
        "D-entry-2",
        "C-manual-adjustment-close",
      ]);
    });

    it("MANUAL_ADJUSTMENT a mais de 1 dia de distância vira entrada nova, mesmo sem evento no meio", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "D-entry",
          product_id: "p2",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-01-10T00:00:00.000Z",
          resulting_average_cost: "200.00",
          manual_average_cost_value: null,
        },
        {
          id: "F-sale-in-between",
          product_id: "p2",
          movement_type: "SALE_OUT",
          movement_date: "2026-01-11T00:00:00.000Z",
          resulting_average_cost: "200.00",
          manual_average_cost_value: null,
        },
        {
          id: "E-manual-adjustment-far",
          product_id: "p2",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-01-12T00:00:00.000Z", // 48h depois de D, fora da janela
          resulting_average_cost: "250.00",
          manual_average_cost_value: "250.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p2"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p2");

      // Os dois devem aparecer separados — E não substituiu D.
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual([
        "E-manual-adjustment-far",
        "D-entry",
      ]);
    });

    it("MANUAL_ADJUSTMENT estritamente adjacente ainda substitui mesmo se a distância de datas for maior que 1 dia", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "H-entry",
          product_id: "p3",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-02-01T00:00:00.000Z",
          resulting_average_cost: "300.00",
          manual_average_cost_value: null,
        },
        {
          id: "I-manual-adjustment-adjacent-but-far-date",
          product_id: "p3",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-02-05T00:00:00.000Z", // 4 dias depois, mas nada aconteceu no meio
          resulting_average_cost: "350.00",
          manual_average_cost_value: "350.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p3"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p3");

      // Adjacência estrita (nada no meio) ainda vale, mesmo passando de 1 dia
      // — só H some, substituído por I.
      expect(entries).toHaveLength(1);
      expect(entries?.[0].id).toBe(
        "I-manual-adjustment-adjacent-but-far-date",
      );
    });

    it("MANUAL_ADJUSTMENT sem custo manual nunca substitui nem entra na pilha", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "J-entry",
          product_id: "p4",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-03-01T00:00:00.000Z",
          resulting_average_cost: "400.00",
          manual_average_cost_value: null,
        },
        {
          id: "K-manual-balance-only",
          product_id: "p4",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "OUT",
          movement_date: "2026-03-01T05:00:00.000Z", // bem próximo, mas sem custo
          resulting_average_cost: "400.00",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p4"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p4");
      expect(entries).toHaveLength(1);
      expect(entries?.[0].id).toBe("J-entry");
    });
  });

  describe("casos adicionais de composição da pilha", () => {
    it("ENTRADA → SAÍDA → AJUSTE (com custo, até 1 dia de distância da entrada) substitui a entrada", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "p5-entry",
          product_id: "p5",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-04-01T00:00:00.000Z",
          resulting_average_cost: "500.00",
          balance_quantity: "3.0000",
          manual_average_cost_value: null,
        },
        {
          id: "p5-sale",
          product_id: "p5",
          movement_type: "SALE_OUT",
          movement_date: "2026-04-01T10:00:00.000Z",
          resulting_average_cost: "500.00",
          balance_quantity: "2.0000",
          manual_average_cost_value: null,
        },
        {
          id: "p5-adjustment",
          product_id: "p5",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-04-01T20:00:00.000Z", // 20h depois da entrada, dentro da janela de 1 dia
          resulting_average_cost: "550.00",
          balance_quantity: "2.0000",
          manual_average_cost_value: "550.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p5"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p5");

      // A pilha final deve ter só o ajuste (substituiu a entrada original)
      expect(entries).toHaveLength(1);
      expect(entries?.[0].id).toBe("p5-adjustment");
      expect(entries?.[0].resulting_average_cost).toBe("550.00");
      expect(entries?.[0].balance_quantity).toBe("2.0000");
    });

    it("ENTRADA → SAÍDA → ENTRADA (duas PURCHASE_ENTRY, sem ajuste no meio) mantém as duas entradas separadas", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "p6-entry-1",
          product_id: "p6",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-05-01T00:00:00.000Z",
          resulting_average_cost: "600.00",
          balance_quantity: "5.0000",
          manual_average_cost_value: null,
        },
        {
          id: "p6-sale",
          product_id: "p6",
          movement_type: "SALE_OUT",
          movement_date: "2026-05-02T00:00:00.000Z",
          resulting_average_cost: "600.00",
          balance_quantity: "3.0000",
          manual_average_cost_value: null,
        },
        {
          id: "p6-entry-2",
          product_id: "p6",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-05-03T00:00:00.000Z",
          resulting_average_cost: "650.00",
          balance_quantity: "8.0000",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p6"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p6");

      // As duas compras ficam separadas na pilha, sem nenhuma mistura de valores
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual(["p6-entry-2", "p6-entry-1"]);
      expect(entries?.[0].resulting_average_cost).toBe("650.00");
      expect(entries?.[0].balance_quantity).toBe("8.0000");
      expect(entries?.[1].resulting_average_cost).toBe("600.00");
      expect(entries?.[1].balance_quantity).toBe("5.0000");
    });

    describe("corte por asOfDate", () => {
      const asOfDate = new Date("2026-06-05T00:00:00.000Z");

      const entryBefore = {
        id: "p7-entry-before",
        product_id: "p7",
        movement_type: "PURCHASE_ENTRY",
        movement_date: "2026-06-01T00:00:00.000Z",
        resulting_average_cost: "700.00",
        balance_quantity: "4.0000",
        manual_average_cost_value: null,
      };

      const entryAfter = {
        id: "p7-entry-after",
        product_id: "p7",
        movement_type: "PURCHASE_ENTRY",
        movement_date: "2026-06-10T00:00:00.000Z",
        resulting_average_cost: "750.00",
        balance_quantity: "6.0000",
        manual_average_cost_value: null,
      };

      it("reflete fielmente o que o mock (banco) devolveu já filtrado por asOfDate, sem refiltrar por conta própria", async () => {
        const { repository, findAll } = makeRepositoryWithMockedModel();
        // Simula o where do banco já excluindo o que é posterior ao asOfDate
        findAll.mockResolvedValue([entryBefore]);

        const result = await repository.findLastPurchaseEntries(
          ["p7"],
          UNIT_BUSINESS_ID,
          asOfDate,
        );

        const entries = result.get("p7");
        expect(entries).toHaveLength(1);
        expect(entries?.[0].id).toBe("p7-entry-before");
      });

      it("se o mock devolver movimentos além do asOfDate (sem filtro real aplicado), a função não refiltra e reflete tudo que recebeu", async () => {
        const { repository, findAll } = makeRepositoryWithMockedModel();
        // Simula um cenário em que o "banco" (mock) devolveu tudo, sem aplicar o where
        findAll.mockResolvedValue([entryBefore, entryAfter]);

        const result = await repository.findLastPurchaseEntries(
          ["p7"],
          UNIT_BUSINESS_ID,
          asOfDate,
        );

        const entries = result.get("p7");
        expect(entries).toHaveLength(2);
        expect(entries?.map((e) => e.id)).toEqual([
          "p7-entry-after",
          "p7-entry-before",
        ]);
      });

      it("passa where.movement_date com Op.lte apontando pro asOfDate correto", async () => {
        const { repository, findAll } = makeRepositoryWithMockedModel();
        findAll.mockResolvedValue([]);

        await repository.findLastPurchaseEntries(
          ["p7"],
          UNIT_BUSINESS_ID,
          asOfDate,
        );

        const callArgs = findAll.mock.calls[0][0];
        expect(callArgs.where.movement_date[Op.lte]).toBe(asOfDate);
      });
    });

    it("ENTRADA → AJUSTE (adjacente) → SAÍDA → AJUSTE (>1 dia e sem adjacência estrita) vira nova entrada, mantendo o ajuste anterior", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "p8-entry",
          product_id: "p8",
          movement_type: "PURCHASE_ENTRY",
          movement_date: "2026-07-01T00:00:00.000Z",
          resulting_average_cost: "800.00",
          balance_quantity: "1.0000",
          manual_average_cost_value: null,
        },
        {
          id: "p8-adjustment-1",
          product_id: "p8",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-07-01T01:00:00.000Z", // estritamente adjacente à entrada
          resulting_average_cost: "820.00",
          balance_quantity: "1.0000",
          manual_average_cost_value: "820.00",
        },
        {
          id: "p8-sale",
          product_id: "p8",
          movement_type: "SALE_OUT",
          movement_date: "2026-07-03T00:00:00.000Z",
          resulting_average_cost: "820.00",
          balance_quantity: "0.5000",
          manual_average_cost_value: null,
        },
        {
          id: "p8-adjustment-2",
          product_id: "p8",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          movement_date: "2026-07-10T00:00:00.000Z", // >1 dia do ajuste-1 e não adjacente (venda no meio)
          resulting_average_cost: "900.00",
          balance_quantity: "0.5000",
          manual_average_cost_value: "900.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastPurchaseEntries(
        ["p8"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p8");

      // p8-adjustment-1 substituiu p8-entry; p8-adjustment-2 não substitui
      // p8-adjustment-1 (nem por adjacência estrita, nem pela janela de 1 dia),
      // então vira uma nova entrada no topo.
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual([
        "p8-adjustment-2",
        "p8-adjustment-1",
      ]);
      expect(entries?.[0].resulting_average_cost).toBe("900.00");
      expect(entries?.[1].resulting_average_cost).toBe("820.00");
    });
  });
});

// ─── findLastMovementsByProducts ───────────────────────────────────────────

describe("StockMovementRepository.findLastMovementsByProducts", () => {
  it("retorna vazio sem chamar o model quando productIds está vazio", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();

    const result = await repository.findLastMovementsByProducts(
      [],
      UNIT_BUSINESS_ID,
    );

    expect(result.size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("retorna o movimento mais recente do produto real (primeiro da ordem DESC)", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsDesc);

    const result = await repository.findLastMovementsByProducts(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
    );

    const last = result.get(PRODUCT_ID);
    expect(last?.id).toBe("42c7192a-897b-40b4-be2a-253c6089ce30");
    expect(last?.balance_quantity).toBe("2.0000");
    expect(last?.resulting_average_cost).toBe("2596.5875");
  });

  it("ignora movimentos repetidos do mesmo produto além do primeiro na ordem DESC", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsDesc);

    const result = await repository.findLastMovementsByProducts(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
    );

    expect(result.size).toBe(1);
  });

  it("monta um Map com uma entrada por produto quando múltiplos produtos são passados", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();

    findAll.mockResolvedValue([
      ...realProductMovementsDesc,
      {
        id: "other-product-movement",
        product_id: "other-product-id",
        movement_type: "PURCHASE_ENTRY",
        movement_date: "2026-08-01T00:00:00.000Z",
        balance_quantity: "10.0000",
        resulting_average_cost: "50.00",
      },
    ]);

    const result = await repository.findLastMovementsByProducts(
      [PRODUCT_ID, "other-product-id"],
      UNIT_BUSINESS_ID,
    );

    expect(result.size).toBe(2);
    expect(result.get("other-product-id")?.id).toBe(
      "other-product-movement",
    );
  });
});