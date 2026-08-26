import { Op } from 'sequelize';
import { StockMovementRepository } from '../../../stock/stock-movements/stock-movements.repository';

jest.mock("../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb) => cb({})),
    where: jest.fn((col, val) => ({ col, val })),
    fn: jest.fn((fnName, ...args) => ({ fnName, args })),
    col: jest.fn((name) => name),
  },
}));

const PRODUCT_ID = "f88bde21-efa6-4955-ba6e-d23bcb4f270c";
const UNIT_BUSINESS_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

// Movimentos reais do produto, já na ordem ASC (como retornados pelo banco)
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
    manual_average_cost_value: null,
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

const realProductMovementsDesc = [...realProductMovementsAsc].reverse();

function makeRepositoryWithMockedModel() {
  const repository = new StockMovementRepository();
  const findAll = jest.fn();
  (repository as any).model = { findAll };
  return { repository, findAll };
}

describe("StockMovementRepository.findLastEffectiveMovements", () => {
  it("retorna vazio sem chamar o model quando productIds está vazio", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();

    const result = await repository.findLastEffectiveMovements(
      [],
      UNIT_BUSINESS_ID,
    );

    expect(result.size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("retorna até limit itens, com topo sempre entry-like (última PURCHASE_ENTRY ou MA com custo)", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsAsc);

    const result = await repository.findLastEffectiveMovements(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
    );

    const entries = result.get(PRODUCT_ID);

    // Pilha final (após colapsamento de correções):
    // - PE(2025-12) correctable=true
    // - MA_no_cost(2026-01) correctable=false (não é entry-like)
    // - PE(2026-07) correctable=true
    // - SO(2026-07) correctable=false
    // Last entry-like: PE(2026-07) no índice 2
    // Com limit=2: slice(1, 3).reverse = [PE(2026-07), MA_no_cost(2026-01)]
    expect(entries).toHaveLength(2);
    expect(entries?.[0].id).toBe("8cddd757-5199-4b74-86c4-06e8bc7a6ab8"); // topo: sempre entry-like
    expect(entries?.[0].movement_type).toBe("PURCHASE_ENTRY");
    expect(entries?.[1].id).toBe("9680f150-a776-4bb2-a37e-bf50087ee051"); // pode ser qualquer tipo
    expect(entries?.[1].movement_type).toBe("MANUAL_ADJUSTMENT");
  });

  it("passa asOfDate como filtro movement_date <= asOfDate pro model", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue([]);
    const asOfDate = new Date("2026-07-10T00:00:00.000Z");

    await repository.findLastEffectiveMovements(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
      asOfDate,
    );

    const callArgs = findAll.mock.calls[0][0];
    expect(callArgs.where.movement_date).toBeDefined();
    expect(callArgs.where.is_active).toBe(true);
    expect(callArgs.where.product_id[Op.in]).toBeDefined();
  });

  it("respeita o parâmetro limit (retorna até limit itens contando de trás do último entry-like)", async () => {
    const { repository, findAll } = makeRepositoryWithMockedModel();
    findAll.mockResolvedValue(realProductMovementsAsc);

    const result = await repository.findLastEffectiveMovements(
      [PRODUCT_ID],
      UNIT_BUSINESS_ID,
      undefined,
      3,
    );

    // Pilha tem 4 itens, último entry-like no índice 2
    // Com limit=3: slice(0, 3).reverse = [PE(2026-07), MA_no_cost(2026-01), PE(2025-12)]
    expect(result.get(PRODUCT_ID)).toHaveLength(3);
    expect(result.get(PRODUCT_ID)?.[0].movement_type).toBe("PURCHASE_ENTRY"); // topo sempre entry-like
  });

  describe("colapso de correção de custo via refers_to == invoice_number (sem janela de tempo)", () => {
    it("MANUAL_ADJUSTMENT com refers_to == invoice_number do topo colapsa (substitui a entrada), mesmo com grande distância de tempo", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "A-entry",
          product_id: "p1",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P1",
          movement_date: "2026-01-01T00:00:00.000Z",
          resulting_average_cost: "100.00",
          manual_average_cost_value: null,
        },
        {
          id: "C-manual-adjustment-correction",
          product_id: "p1",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          refers_to: "INV-P1",
          movement_date: "2026-06-01T20:00:00.000Z",
          resulting_average_cost: "120.00",
          manual_average_cost_value: "120.00",
        },
        {
          id: "D-entry-2",
          product_id: "p1",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P1-2",
          movement_date: "2026-07-01T00:00:00.000Z",
          resulting_average_cost: "200.00",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p1"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p1");

      // C.refers_to bate com o invoice_number do topo (A-entry) no momento em que é
      // processado -> substitui A na pilha, mesmo estando 5 meses depois.
      // Pilha após substituição: [C-manual-adjustment-correction, D-entry-2]
      // Last entry-like: D no índice 1
      // Com limit=3: slice(0, 2).reverse = [D, C]
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual([
        "D-entry-2",
        "C-manual-adjustment-correction",
      ]);
    });

    it("MANUAL_ADJUSTMENT com refers_to que NÃO bate com o invoice_number do topo não colapsa (vira item novo, mas continua entry-like)", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "D-entry",
          product_id: "p2",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P2",
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
          id: "E-manual-adjustment-other-invoice",
          product_id: "p2",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          refers_to: "INV-OTHER",
          movement_date: "2026-01-12T00:00:00.000Z",
          resulting_average_cost: "250.00",
          manual_average_cost_value: "250.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p2"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p2");

      // Pilha: [D-entry(correctable), F-sale(not), E-manual(correctable, refers_to não
      // bate com o invoice_number do topo -> não substitui D, vira item novo)]
      // Last entry-like: E no índice 2
      // Com limit=3: slice(0, 3).reverse = [E, F, D]
      expect(entries).toHaveLength(3);
      expect(entries?.map((e) => e.id)).toEqual([
        "E-manual-adjustment-other-invoice",
        "F-sale-in-between",
        "D-entry",
      ]);
    });

    it("MANUAL_ADJUSTMENT com refers_to mas SEM manual_average_cost_value é ajuste de quantidade puro: não colapsa e não é entry-like", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "L-entry",
          product_id: "p9",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P9",
          movement_date: "2026-03-01T00:00:00.000Z",
          resulting_average_cost: "400.00",
          manual_average_cost_value: null,
        },
        {
          id: "M-manual-qty-only",
          product_id: "p9",
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "OUT",
          refers_to: "INV-P9",
          movement_date: "2026-03-01T05:00:00.000Z",
          resulting_average_cost: "400.00",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p9"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p9");

      // M tem refers_to preenchido mas manual_average_cost_value null -> é só um
      // ajuste de quantidade, NÃO conta como correção de custo: não substitui o
      // topo (L) e não é entry-like (mesmo tratamento que SALE_OUT/CUSTOMER_RETURN).
      expect(entries).toHaveLength(1);
      expect(entries?.[0].id).toBe("L-entry");
      expect(entries?.[0].movement_type).toBe("PURCHASE_ENTRY");
    });

    it("MANUAL_ADJUSTMENT sem custo entra como item qualquer, não entry-like", async () => {
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
          movement_date: "2026-03-01T05:00:00.000Z",
          resulting_average_cost: "400.00",
          manual_average_cost_value: null,
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p4"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p4");
      
      expect(entries).toHaveLength(1);
      expect(entries?.[0].id).toBe("J-entry");
      expect(entries?.[0].movement_type).toBe("PURCHASE_ENTRY");
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

      it("reflete o que o mock devolveu já filtrado por asOfDate", async () => {
        const { repository, findAll } = makeRepositoryWithMockedModel();
        findAll.mockResolvedValue([entryBefore]);

        const result = await repository.findLastEffectiveMovements(
          ["p7"],
          UNIT_BUSINESS_ID,
          asOfDate,
        );

        const entries = result.get("p7");
        expect(entries).toHaveLength(1);
        expect(entries?.[0].id).toBe("p7-entry-before");
      });

      it("passa where.movement_date com Op.lte apontando pro asOfDate", async () => {
        const { repository, findAll } = makeRepositoryWithMockedModel();
        findAll.mockResolvedValue([]);

        await repository.findLastEffectiveMovements(
          ["p7"],
          UNIT_BUSINESS_ID,
          asOfDate,
        );

        const callArgs = findAll.mock.calls[0][0];
        expect(callArgs.where.movement_date[Op.lte]).toBe(asOfDate);
      });
    });
  });

  describe("casos adicionais de composição da pilha", () => {
    it("ENTRADA → SAÍDA → AJUSTE (refers_to aponta pra entrada) retorna ajuste + saída", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "p5-entry",
          product_id: "p5",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P5",
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
          refers_to: "INV-P5",
          movement_date: "2026-04-01T20:00:00.000Z",
          resulting_average_cost: "550.00",
          balance_quantity: "2.0000",
          manual_average_cost_value: "550.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p5"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p5");

      // p5-adjustment.refers_to bate com o invoice_number de p5-entry, mas quando
      // é processado o topo da pilha é p5-sale (não p5-entry) -> não colapsa,
      // vira um item novo, ele mesmo entry-like.
      // Pilha: [p5-entry, p5-sale, p5-adjustment]
      // Last entry-like: p5-adjustment no índice 2
      // Com limit=2: slice(1, 3).reverse = [adjustment, sale]
      expect(entries).toHaveLength(2);
      expect(entries?.[0].id).toBe("p5-adjustment");
      expect(entries?.[1].id).toBe("p5-sale");
    });

    it("ENTRADA → SAÍDA → ENTRADA (duas PURCHASE_ENTRY) retorna com saída no meio", async () => {
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

      const result = await repository.findLastEffectiveMovements(
        ["p6"],
        UNIT_BUSINESS_ID,
      );

      const entries = result.get("p6");

      // Pilha: [p6-entry-1, p6-sale, p6-entry-2]
      // Last entry-like: p6-entry-2 no índice 2
      // Com limit=2: slice(1, 3).reverse = [p6-entry-2, p6-sale]
      expect(entries).toHaveLength(2);
      expect(entries?.map((e) => e.id)).toEqual(["p6-entry-2", "p6-sale"]);
    });

    it("ENTRADA → AJUSTE (refers_to bate, colapsa) → SAÍDA → AJUSTE (refers_to não bate, novo) retorna com intervalo até limit", async () => {
      const { repository, findAll } = makeRepositoryWithMockedModel();

      const movements = [
        {
          id: "p8-entry",
          product_id: "p8",
          movement_type: "PURCHASE_ENTRY",
          invoice_number: "INV-P8",
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
          refers_to: "INV-P8",
          movement_date: "2026-07-01T01:00:00.000Z",
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
          refers_to: "INV-P8-LATER",
          movement_date: "2026-07-10T00:00:00.000Z",
          resulting_average_cost: "900.00",
          balance_quantity: "0.5000",
          manual_average_cost_value: "900.00",
        },
      ];
      findAll.mockResolvedValue(movements);

      const result = await repository.findLastEffectiveMovements(
        ["p8"],
        UNIT_BUSINESS_ID,
        undefined,
        3,
      );

      const entries = result.get("p8");

      // p8-adjustment-1.refers_to bate com o invoice_number do topo (p8-entry,
      // que é o topo no momento) -> colapsa/substitui.
      // Pilha após substituição: [p8-adjustment-1(invoiceKey=INV-P8), p8-sale,
      // p8-adjustment-2(refers_to=INV-P8-LATER não bate com o topo p8-sale -> item novo)]
      // Last entry-like: p8-adjustment-2 no índice 2
      // Com limit=3: slice(0, 3).reverse = [adjustment-2, sale, adjustment-1]
      expect(entries).toHaveLength(3);
      expect(entries?.map((e) => e.id)).toEqual([
        "p8-adjustment-2",
        "p8-sale",
        "p8-adjustment-1",
      ]);
    });
  });
});

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
});
