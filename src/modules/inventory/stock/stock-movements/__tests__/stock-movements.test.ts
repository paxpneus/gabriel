import { Op } from "sequelize";
import { StockMovementService } from "./../stock-movements.service";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock(
  "../../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service",
  () => ({
    __esModule: true,
    default: { findAll: jest.fn() },
  }),
);

jest.mock("../stock-movements.repository", () => ({
  __esModule: true,
  default: {
    findLastMovement: jest.fn(),
    findLastMovementBefore: jest.fn(),
    findMovementsFrom: jest.fn(),
    deleteByInvoiceAndProduct: jest.fn(),
    findHistoryByProduct: jest.fn(),
    setActiveStatus: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
    bulkDelete: jest.fn(),
  },
}));

jest.mock(
  "../../stock-movement-source-data/stock-movement-source-data.service",
  () => ({
    __esModule: true,
    default: { findOne: jest.fn() },
  }),
);


import { Invoice, UnitBusiness } from "../../../../warehouse";
import InvoiceFiscalItem from "../../../../warehouse/fiscal/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceItemsService from "../../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";
import StockMovement from "../stock-movements.model";
import stockMovementSourceDataService from "../../stock-movement-source-data/stock-movement-source-data.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRODUCT_ID = "product-uuid";
const UNIT_BUSINESS_ID = "ub-uuid";
const UNIT_BUSINESS_CNPJ = "02316749002111";

const mockUnitBusiness = { id: UNIT_BUSINESS_ID, cnpj: UNIT_BUSINESS_CNPJ };

function makeInvoiceItem(overrides: Partial<any> = {}) {
  return {
    invoice_id: "invoice-1",
    product_id: PRODUCT_ID,
    quantity_expected: 10,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<any> = {}) {
  return {
    id: "invoice-1",
    sender_cnpj: "OUTRO-CNPJ",
    emitted_at: new Date("2026-01-10T00:00:00Z"),
    number_system: "123",
    unitBusinessAttributes: [
      { unit_business_id: UNIT_BUSINESS_ID, type: "INCOMING" },
    ],
    ...overrides,
  };
}

function makeFiscalItem(overrides: Partial<any> = {}) {
  return {
    invoice_id: "invoice-1",
    unit_price: 15.5,
    ...overrides,
  };
}

// Simula uma linha já persistida (StockMovement instance), com .update()
// mockado, útil pros testes de upsert/reindex/updateManualAverageCost.
function makeExistingMovement(overrides: Partial<any> = {}) {
  const movement: any = {
    id: "mov-id",
    invoice_id: "inv-1",
    invoice_number: "1",
    movement_type: "PURCHASE_ENTRY",
    movement_date: new Date("2026-01-01"),
    movement_quantity: 10,
    unit_cost_invoice: 10,
    balance_quantity: 10,
    resulting_average_cost: 10,
    manual_average_cost_value: null,
    refers_to: null,
    is_active: true,
    direction: null,
    ...overrides,
  };
  movement.update = jest.fn().mockImplementation((patch) => {
    Object.assign(movement, patch);
    return Promise.resolve(movement);
  });
  return movement;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("StockMovementService", () => {
  let service: StockMovementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StockMovementService();

    // Repositório interno do service
    (service as any).repository = {
      findLastMovement: jest.fn(),
      findLastMovementBefore: jest.fn(),
      findByInvoiceNumberAndType: jest.fn(),
      findHistoryByProduct: jest.fn().mockResolvedValue([]),
      bulkCreate: jest
        .fn()
        .mockImplementation((rows: any[]) => Promise.resolve(rows)),
      bulkDelete: jest.fn().mockResolvedValue(0),
      setActiveStatus: jest.fn().mockResolvedValue(undefined),
      create: jest
        .fn()
        .mockImplementation((row: any) =>
          Promise.resolve({ ...row, update: jest.fn() }),
        ),
    };

    (UnitBusiness.findByPk as jest.Mock).mockResolvedValue(mockUnitBusiness);
    (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([]);
    (Invoice.findAll as jest.Mock).mockResolvedValue([]);
    (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([]);
    (stockMovementSourceDataService.findOne as jest.Mock).mockResolvedValue(
      null,
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateNextState (privado — acessado via (service as any))
  // ══════════════════════════════════════════════════════════════════════════

  describe("calculateNextState", () => {
    it("PURCHASE_ENTRY sem histórico anterior: CMP = custo da NF", () => {
      const result = (service as any).calculateNextState(null, {
        movement_type: "PURCHASE_ENTRY",
        movement_quantity: 10,
        unit_cost_invoice: 20,
      });

      expect(result).toEqual({
        balance_quantity: 10,
        resulting_average_cost: 20,
        total_stock_value: 200,
      });
    });

    it("PURCHASE_ENTRY com estoque anterior zerado: CMP = custo da NF (ignora custo antigo)", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 0, resulting_average_cost: 999 },
        {
          movement_type: "PURCHASE_ENTRY",
          movement_quantity: 5,
          unit_cost_invoice: 10,
        },
      );

      expect(result).toEqual({
        balance_quantity: 5,
        resulting_average_cost: 10,
        total_stock_value: 50,
      });
    });

    it("PURCHASE_ENTRY com estoque anterior positivo: calcula média ponderada", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 10, resulting_average_cost: 10 },
        {
          movement_type: "PURCHASE_ENTRY",
          movement_quantity: 10,
          unit_cost_invoice: 20,
        },
      );

      expect(result).toEqual({
        balance_quantity: 20,
        resulting_average_cost: 15,
        total_stock_value: 300,
      });
    });

    it("SALE_OUT: reduz quantidade e mantém o CMP anterior", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 10, resulting_average_cost: 15 },
        {
          movement_type: "SALE_OUT",
          movement_quantity: 4,
          unit_cost_invoice: 999,
        },
      );

      expect(result).toEqual({
        balance_quantity: 6,
        resulting_average_cost: 15,
        total_stock_value: 90,
      });
    });

    it("SALE_OUT: permite saldo negativo", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 2, resulting_average_cost: 10 },
        {
          movement_type: "SALE_OUT",
          movement_quantity: 5,
          unit_cost_invoice: 0,
        },
      );

      expect(result.balance_quantity).toBe(-3);
      expect(result.resulting_average_cost).toBe(10);
    });

    it("CUSTOMER_RETURN: aumenta quantidade e mantém o CMP anterior (congelado)", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 6, resulting_average_cost: 15 },
        {
          movement_type: "CUSTOMER_RETURN",
          movement_quantity: 2,
          unit_cost_invoice: 999,
        },
      );

      expect(result).toEqual({
        balance_quantity: 8,
        resulting_average_cost: 15,
        total_stock_value: 120,
      });
    });

    it("MANUAL_ADJUSTMENT com direction IN: soma ao saldo e mantém o CMP anterior", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 10, resulting_average_cost: 8 },
        {
          movement_type: "MANUAL_ADJUSTMENT",
          movement_quantity: 5,
          direction: "IN",
        },
      );

      expect(result).toEqual({
        balance_quantity: 15,
        resulting_average_cost: 8,
        total_stock_value: 120,
      });
    });

    it("MANUAL_ADJUSTMENT com direction OUT: subtrai do saldo e mantém o CMP anterior", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 10, resulting_average_cost: 8 },
        {
          movement_type: "MANUAL_ADJUSTMENT",
          movement_quantity: 3,
          direction: "OUT",
        },
      );

      expect(result).toEqual({
        balance_quantity: 7,
        resulting_average_cost: 8,
        total_stock_value: 56,
      });
    });

    it("MANUAL_ADJUSTMENT sem histórico anterior e direction IN: parte de saldo/custo zero", () => {
      const result = (service as any).calculateNextState(null, {
        movement_type: "MANUAL_ADJUSTMENT",
        movement_quantity: 5,
        direction: "IN",
      });

      expect(result).toEqual({
        balance_quantity: 5,
        resulting_average_cost: 0,
        total_stock_value: 0,
      });
    });

    it("manual_average_cost_value, quando presente, sobrescreve o CMP calculado (qualquer tipo)", () => {
      const result = (service as any).calculateNextState(
        { balance_quantity: 10, resulting_average_cost: 10 },
        {
          movement_type: "SALE_OUT",
          movement_quantity: 2,
          manual_average_cost_value: 99,
        },
      );

      expect(result.resulting_average_cost).toBe(99);
      expect(result.total_stock_value).toBe(8 * 99);
    });

    it("lança erro para movement_type desconhecido", () => {
      expect(() =>
        (service as any).calculateNextState(null, {
          movement_type: "INVALID_TYPE",
          movement_quantity: 1,
          unit_cost_invoice: 1,
        }),
      ).toThrow("Tipo de movimento inválido: INVALID_TYPE");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // reindexProduct
  // ══════════════════════════════════════════════════════════════════════════

  describe("reindexProduct", () => {
    const movements = [
      {
        product_id: PRODUCT_ID,
        invoice_id: "inv-2",
        invoice_number: "2",
        movement_type: "SALE_OUT" as const,
        movement_date: new Date("2026-02-01"),
        movement_quantity: 3,
      },
      {
        product_id: PRODUCT_ID,
        invoice_id: "inv-1",
        invoice_number: "1",
        movement_type: "PURCHASE_ENTRY" as const,
        movement_date: new Date("2026-01-01"),
        movement_quantity: 10,
        unit_cost_invoice: 10,
      },
    ];

    it("busca o histórico incluindo inativos (activeOnly = false)", async () => {
      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect(
        (service as any).repository.findHistoryByProduct,
      ).toHaveBeenCalledWith(PRODUCT_ID, UNIT_BUSINESS_ID, {
        transaction: undefined,
        activeOnly: false,
      });
    });

    it("ordena os movimentos por data antes de processar, independente da ordem de entrada", async () => {
      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];

      expect(created[0].invoice_id).toBe("inv-1");
      expect(created[1].invoice_id).toBe("inv-2");
    });

    it("calcula o estado encadeado corretamente (entrada seguida de saída) e marca is_active true", async () => {
      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];

      expect(created[0]).toMatchObject({
        balance_quantity: 10,
        resulting_average_cost: 10,
        is_active: true,
      });
      expect(created[1]).toMatchObject({
        balance_quantity: 7,
        resulting_average_cost: 10,
        is_active: true,
      });
    });

    it("apaga (hard delete) somente as linhas NÃO protegidas, via id", async () => {
      const existing = [
        makeExistingMovement({ id: "old-1", invoice_id: "inv-1" }),
      ];
      (service as any).repository.findHistoryByProduct.mockResolvedValue(
        existing,
      );

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect((service as any).repository.bulkDelete).toHaveBeenCalledWith({
        where: { id: { [Op.in]: ["old-1"] } },
        transaction: undefined,
      });
    });

    it("NÃO chama bulkDelete quando não há linhas deletáveis", async () => {
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect((service as any).repository.bulkDelete).not.toHaveBeenCalled();
    });

    it("preserva um MANUAL_ADJUSTMENT existente: não é deletado, não é recriado, e serve de base para a cadeia", async () => {
      const manualAdjustment = makeExistingMovement({
        id: "manual-1",
        invoice_id: null,
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-15"),
        balance_quantity: 50,
        resulting_average_cost: 12,
        manual_average_cost_value: 12,
        refers_to: "1",
        is_active: true,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        manualAdjustment,
      ]);

      // movimento novo posterior ao ajuste manual
      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-9",
          invoice_number: "9",
          movement_type: "SALE_OUT" as const,
          movement_date: new Date("2026-02-01"),
          movement_quantity: 5,
        },
      ];

      const result = await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect((service as any).repository.bulkDelete).not.toHaveBeenCalled();

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        invoice_id: "inv-9",
        balance_quantity: 45, // 50 - 5, encadeado a partir do manual adjustment
        resulting_average_cost: 12,
      });

      // resultado final inclui o manual adjustment intocado + o novo criado
      expect(result.map((m: any) => m.id ?? m.invoice_id)).toEqual(
        expect.arrayContaining(["manual-1", "inv-9"]),
      );
    });

    it("recria uma linha com custo manual que não seja MANUAL_ADJUSTMENT", async () => {
      const overridden = makeExistingMovement({
        id: "override-1",
        invoice_id: "inv-override",
        movement_type: "PURCHASE_ENTRY",
        manual_average_cost_value: 77,
        balance_quantity: 20,
        resulting_average_cost: 77,
        is_active: true,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        overridden,
      ]);

      await service.reindexProduct(PRODUCT_ID, UNIT_BUSINESS_ID, [] as any);

      expect((service as any).repository.bulkDelete).toHaveBeenCalled();
      expect((service as any).repository.bulkCreate).not.toHaveBeenCalled();
    });

    it("MANUAL_ADJUSTMENT com manual_average_cost_value mas sem refers_to NÃO é protegido (a proteção agora é só refers_to)", async () => {
      const manualAdjustment = makeExistingMovement({
        id: "manual-1",
        invoice_id: null,
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-15"),
        balance_quantity: 50,
        resulting_average_cost: 12,
        manual_average_cost_value: 12,
        refers_to: null,
        is_active: true,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        manualAdjustment,
      ]);

      await service.reindexProduct(PRODUCT_ID, UNIT_BUSINESS_ID, [] as any);

      expect((service as any).repository.bulkDelete).toHaveBeenCalledWith({
        where: { id: { [Op.in]: ["manual-1"] } },
        transaction: undefined,
      });
    });

    it("não protege MANUAL_ADJUSTMENT sem custo manual contra uma fonte com o mesmo invoice_id", async () => {
      const manualAdjustment = makeExistingMovement({
        id: "manual-1",
        invoice_id: "inv-protected",
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-15"),
        balance_quantity: 50,
        resulting_average_cost: 12,
        is_active: true,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        manualAdjustment,
      ]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-protected", // tenta reintroduzir o mesmo invoice_id
          invoice_number: "x",
          movement_type: "PURCHASE_ENTRY" as const,
          movement_date: new Date("2026-01-20"),
          movement_quantity: 100,
          unit_cost_invoice: 1,
        },
      ];

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect((service as any).repository.bulkDelete).toHaveBeenCalled();
      expect((service as any).repository.bulkCreate).toHaveBeenCalled();
    });

    it("MANUAL_ADJUSTMENT inativo sem custo manual é removido e não entra na cadeia", async () => {
      const inactiveManual = makeExistingMovement({
        id: "manual-inactive",
        invoice_id: null,
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-15"),
        balance_quantity: 999,
        resulting_average_cost: 999,
        is_active: false,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        inactiveManual,
      ]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-10",
          invoice_number: "10",
          movement_type: "PURCHASE_ENTRY" as const,
          movement_date: new Date("2026-02-01"),
          movement_quantity: 10,
          unit_cost_invoice: 5,
        },
      ];

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect((service as any).repository.bulkDelete).toHaveBeenCalled();

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];
      // parte do zero, ignorando o saldo absurdo do manual inativo
      expect(created[0]).toMatchObject({
        balance_quantity: 10,
        resulting_average_cost: 5,
      });
    });

    it("não retorna MANUAL_ADJUSTMENT sem custo manual após recriar o histórico", async () => {
      const fakeCreated = [
        { id: "new-1", movement_date: new Date("2026-02-01") },
      ];
      (service as any).repository.bulkCreate.mockResolvedValue(fakeCreated);

      const manualAdjustment = makeExistingMovement({
        id: "manual-1",
        invoice_id: null,
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-01"),
      });
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        manualAdjustment,
      ]);

      const result = await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [
          {
            product_id: PRODUCT_ID,
            invoice_id: "inv-2",
            invoice_number: "2",
            movement_type: "SALE_OUT",
            movement_date: new Date("2026-02-01"),
            movement_quantity: 1,
          },
        ] as any,
      );

      expect(result.map((m: any) => m.id)).toEqual(["new-1"]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // upsertProductStockMovements
  // ══════════════════════════════════════════════════════════════════════════

  describe("upsertProductStockMovements", () => {
    it("cria uma linha nova quando o invoice_id ainda não existe", async () => {
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1",
          invoice_number: "1",
          movement_type: "PURCHASE_ENTRY" as const,
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ];

      await service.upsertProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect((service as any).repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_id: "inv-1",
          balance_quantity: 10,
          resulting_average_cost: 10,
          is_active: true,
        }),
        { transaction: undefined },
      );
    });

    it("não recria nem recalcula movimentos cobertos pela última extração CSV", async () => {
      const consolidated = makeExistingMovement({
        status: "SYNCHED",
        movement_date: new Date("2026-01-10"),
      });
      (stockMovementSourceDataService.findOne as jest.Mock).mockResolvedValue({
        extraction_date: new Date("2026-01-31T23:59:59Z"),
      });
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        consolidated,
      ]);

      await service.upsertProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [
          {
            product_id: PRODUCT_ID,
            invoice_id: "inv-1",
            invoice_number: "1",
            movement_type: "PURCHASE_ENTRY",
            movement_date: new Date("2026-01-10"),
            movement_quantity: 99,
            unit_cost_invoice: 99,
          },
        ] as any,
      );

      expect(consolidated.update).not.toHaveBeenCalled();
      expect((service as any).repository.create).not.toHaveBeenCalled();
    });

    it("atualiza (update) uma linha existente, recalculando balance/CMP, sem tocar em manual_average_cost_value", async () => {
      const existing = makeExistingMovement({
        invoice_id: "inv-1",
        manual_average_cost_value: 50,
        balance_quantity: 10,
        resulting_average_cost: 50,
      });
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        existing,
      ]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1",
          invoice_number: "1",
          movement_type: "PURCHASE_ENTRY" as const,
          movement_date: new Date("2026-01-01"),
          movement_quantity: 20,
          unit_cost_invoice: 999, // deve ser irrelevante: override manda
        },
      ];

      await service.upsertProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect(existing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          movement_quantity: 20,
          resulting_average_cost: 50, // override preservado
        }),
        { transaction: undefined },
      );
      expect(existing.update.mock.calls[0][0]).not.toHaveProperty(
        "manual_average_cost_value",
      );
    });

    it("MANUAL_ADJUSTMENT existente participa da cadeia mas nunca sofre update", async () => {
      const manualAdjustment = makeExistingMovement({
        id: "manual-1",
        invoice_id: null,
        movement_type: "MANUAL_ADJUSTMENT",
        movement_date: new Date("2026-01-15"),
        direction: "IN",
        balance_quantity: 50,
        movement_quantity: 50,
        resulting_average_cost: 12,
        manual_average_cost_value: 12,
        total_stock_value: 600,
      });
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        manualAdjustment,
      ]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-9",
          invoice_number: "9",
          movement_type: "SALE_OUT" as const,
          movement_date: new Date("2026-02-01"),
          movement_quantity: 5,
        },
      ];

      const result = await service.upsertProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect(manualAdjustment.update).not.toHaveBeenCalled();
      expect((service as any).repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoice_id: "inv-9",
          balance_quantity: 45,
          resulting_average_cost: 12,
        }),
        { transaction: undefined },
      );
      expect(result).toEqual(expect.arrayContaining([manualAdjustment]));
    });

    it("movimentos recebidos sem invoice_id (que não sejam via createManualAdjustment) são ignorados no merge", async () => {
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      const incoming = [
        {
          product_id: PRODUCT_ID,
          invoice_id: undefined,
          movement_type: "PURCHASE_ENTRY" as const,
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ];

      await service.upsertProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        incoming as any,
      );

      expect((service as any).repository.create).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createManualAdjustment
  // ══════════════════════════════════════════════════════════════════════════

  describe("createManualAdjustment", () => {
    it("cria um MANUAL_ADJUSTMENT com direction IN para PURCHASE_ENTRY, sem invoice_id, e recalcula a cadeia", async () => {
      (service as any).repository.findLastMovementBefore.mockResolvedValue(
        null,
      );
      const upsertSpy = jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
        movement_quantity: 8,
        direction_type: "PURCHASE_ENTRY",
        manual_average_cost_value: 30,
      });

      expect((service as any).repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          movement_type: "MANUAL_ADJUSTMENT",
          direction: "IN",
          invoice_id: null,
          movement_quantity: 8,
          manual_average_cost_value: 30,
          balance_quantity: 8,
          resulting_average_cost: 30,
          is_active: true,
        }),
        { transaction: undefined },
      );
      expect(upsertSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [],
        undefined,
      );
    });

    it("cria um MANUAL_ADJUSTMENT com direction OUT para SALE_OUT, encadeando a partir do movimento anterior à data informada", async () => {
      (service as any).repository.findLastMovementBefore.mockResolvedValue({
        balance_quantity: 20,
        resulting_average_cost: 10,
      });
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      const movementDate = new Date("2026-03-01");

      await service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
        movement_quantity: 5,
        direction_type: "SALE_OUT",
        movement_date: movementDate,
      });

      expect(
        (service as any).repository.findLastMovementBefore,
      ).toHaveBeenCalledWith(PRODUCT_ID, UNIT_BUSINESS_ID, movementDate);

      expect((service as any).repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: "OUT",
          movement_date: movementDate,
          balance_quantity: 15, // 20 - 5
          resulting_average_cost: 10,
          manual_average_cost_value: null,
        }),
        { transaction: undefined },
      );
    });

    it("usa a data atual quando movement_date não é informado", async () => {
      (service as any).repository.findLastMovementBefore.mockResolvedValue(
        null,
      );
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      const before = Date.now();
      await service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
        movement_quantity: 1,
        direction_type: "PURCHASE_ENTRY",
      });
      const after = Date.now();

      const created = (service as any).repository.create.mock.calls[0][0];
      expect(created.movement_date.getTime()).toBeGreaterThanOrEqual(before);
      expect(created.movement_date.getTime()).toBeLessThanOrEqual(after);
    });

    it("aceita refers_to junto de manual_average_cost_value, validando contra uma PURCHASE_ENTRY existente", async () => {
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(
        makeExistingMovement({ movement_type: "PURCHASE_ENTRY" }),
      );
      (service as any).repository.findLastMovementBefore.mockResolvedValue(
        null,
      );
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
        movement_quantity: 8,
        direction_type: "PURCHASE_ENTRY",
        manual_average_cost_value: 30,
        refers_to: "1",
      });

      expect((service as any).repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ refers_to: "1" }),
        { transaction: undefined },
      );
    });

    it("rejeita refers_to sem manual_average_cost_value", async () => {
      await expect(
        service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
          movement_quantity: 8,
          direction_type: "PURCHASE_ENTRY",
          refers_to: "1",
        }),
      ).rejects.toThrow(/refers_to/);
      expect((service as any).repository.create).not.toHaveBeenCalled();
    });

    it("rejeita refers_to que não corresponde a nenhuma PURCHASE_ENTRY do produto", async () => {
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(null);

      await expect(
        service.createManualAdjustment(PRODUCT_ID, UNIT_BUSINESS_ID, {
          movement_quantity: 8,
          direction_type: "PURCHASE_ENTRY",
          manual_average_cost_value: 30,
          refers_to: "inexistente",
        }),
      ).rejects.toThrow(/refers_to/);
      expect((service as any).repository.create).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateManualAverageCost
  // ══════════════════════════════════════════════════════════════════════════

  describe("updateManualAverageCost", () => {
    it("lança erro quando o movimento (por id) não é encontrado", async () => {
      (StockMovement.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateManualAverageCost(
          PRODUCT_ID,
          UNIT_BUSINESS_ID,
          "movement-id-x",
          100,
        ),
      ).rejects.toThrow(/movement-id-x/);
    });

    it("busca por id (não mais por invoice_id), atualiza o valor e recalcula a cadeia via upsert", async () => {
      const movement = makeExistingMovement({
        id: "movement-id-x",
        movement_type: "MANUAL_ADJUSTMENT",
      });
      (StockMovement.findOne as jest.Mock).mockResolvedValue(movement);

      const upsertSpy = jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.updateManualAverageCost(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        "movement-id-x",
        123,
      );

      expect(StockMovement.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "movement-id-x",
            product_id: PRODUCT_ID,
            unit_business_id: UNIT_BUSINESS_ID,
          },
        }),
      );
      expect(movement.update).toHaveBeenCalledWith(
        { manual_average_cost_value: 123, refers_to: null },
        { transaction: undefined },
      );
      expect(upsertSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [],
        undefined,
      );
    });

    it("aceita null para remover o override", async () => {
      const movement = makeExistingMovement({
        id: "movement-id-x",
        movement_type: "MANUAL_ADJUSTMENT",
      });
      (StockMovement.findOne as jest.Mock).mockResolvedValue(movement);
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.updateManualAverageCost(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        "movement-id-x",
        null,
      );

      expect(movement.update).toHaveBeenCalledWith(
        { manual_average_cost_value: null, refers_to: null },
        { transaction: undefined },
      );
    });

    it("aceita refersTo e grava refers_to junto do override, validando contra uma PURCHASE_ENTRY existente", async () => {
      const movement = makeExistingMovement({
        id: "movement-id-x",
        movement_type: "MANUAL_ADJUSTMENT",
      });
      (StockMovement.findOne as jest.Mock).mockResolvedValue(movement); // busca por id
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(
        makeExistingMovement({ movement_type: "PURCHASE_ENTRY" }),
      ); // validação do refers_to
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.updateManualAverageCost(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        "movement-id-x",
        123,
        "1",
      );

      expect(movement.update).toHaveBeenCalledWith(
        {
          manual_average_cost_value: 123,
          refers_to: "1",
          movement_date: new Date("2026-01-01T00:00:05.000Z"),
        },
        { transaction: undefined },
      );
    });

    it("remover o override (null) limpa refers_to automaticamente, mesmo se refersTo for informado", async () => {
      const movement = makeExistingMovement({
        id: "movement-id-x",
        movement_type: "MANUAL_ADJUSTMENT",
        refers_to: "1",
      });
      (StockMovement.findOne as jest.Mock).mockResolvedValue(movement);
      jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      await service.updateManualAverageCost(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        "movement-id-x",
        null,
        "1",
      );

      expect(movement.update).toHaveBeenCalledWith(
        { manual_average_cost_value: null, refers_to: null },
        { transaction: undefined },
      );
    });

    it("rejeita refersTo que não corresponde a nenhuma PURCHASE_ENTRY do produto", async () => {
      const movement = makeExistingMovement({
        id: "movement-id-x",
        movement_type: "MANUAL_ADJUSTMENT",
      });
      (StockMovement.findOne as jest.Mock).mockResolvedValue(movement); // busca por id
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(null); // refers_to não encontrado

      await expect(
        service.updateManualAverageCost(
          PRODUCT_ID,
          UNIT_BUSINESS_ID,
          "movement-id-x",
          123,
          "inexistente",
        ),
      ).rejects.toThrow(/refers_to/);
      expect(movement.update).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // realignRefersToMovementDates
  // ══════════════════════════════════════════════════════════════════════════

  describe("realignRefersToMovementDates", () => {
    it("realinha um MANUAL_ADJUSTMENT ancorado cuja data ficou antes da PURCHASE_ENTRY referenciada", async () => {
      const referencedEntry = makeExistingMovement({
        id: "entry-1",
        movement_type: "PURCHASE_ENTRY",
        invoice_number: "1",
        movement_date: new Date("2026-03-01T15:00:00Z"),
      });
      const adjustment = makeExistingMovement({
        id: "manual-1",
        movement_type: "MANUAL_ADJUSTMENT",
        refers_to: "1",
        // data antiga, de antes da PURCHASE_ENTRY ter sido recriada com um
        // horário novo — fica fora de ordem.
        movement_date: new Date("2026-03-01T12:00:05Z"),
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        adjustment,
      ]);
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(
        referencedEntry,
      );

      const result = await service.realignRefersToMovementDates(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(
        (service as any).repository.findByInvoiceNumberAndType,
      ).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        "1",
        "PURCHASE_ENTRY",
        undefined,
      );
      expect(adjustment.update).toHaveBeenCalledWith(
        { movement_date: new Date("2026-03-01T15:00:05Z") },
        { transaction: undefined },
      );
      expect(result).toEqual([adjustment]);
    });

    it("não mexe quando o ajuste já está alinhado (5s depois da PURCHASE_ENTRY)", async () => {
      const referencedEntry = makeExistingMovement({
        movement_type: "PURCHASE_ENTRY",
        invoice_number: "1",
        movement_date: new Date("2026-03-01T15:00:00Z"),
      });
      const adjustment = makeExistingMovement({
        movement_type: "MANUAL_ADJUSTMENT",
        refers_to: "1",
        movement_date: new Date("2026-03-01T15:00:05Z"),
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        adjustment,
      ]);
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(
        referencedEntry,
      );

      const result = await service.realignRefersToMovementDates(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(adjustment.update).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("ignora movimentos sem refers_to", async () => {
      const plain = makeExistingMovement({
        movement_type: "MANUAL_ADJUSTMENT",
        refers_to: null,
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        plain,
      ]);

      const result = await service.realignRefersToMovementDates(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(
        (service as any).repository.findByInvoiceNumberAndType,
      ).not.toHaveBeenCalled();
      expect(plain.update).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("ignora âncora órfã (PURCHASE_ENTRY referenciada não existe mais)", async () => {
      const adjustment = makeExistingMovement({
        movement_type: "MANUAL_ADJUSTMENT",
        refers_to: "sumiu",
      });

      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        adjustment,
      ]);
      (
        service as any
      ).repository.findByInvoiceNumberAndType.mockResolvedValue(null);

      const result = await service.realignRefersToMovementDates(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(adjustment.update).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deactivateStockMovements / reactivateStockMovements
  // ══════════════════════════════════════════════════════════════════════════

  describe("deactivateStockMovements", () => {
    it("marca is_active = false em lote e recalcula a cadeia via upsert", async () => {
      const upsertSpy = jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      const ids = ["mov-1", "mov-2"];
      await service.deactivateStockMovements(PRODUCT_ID, UNIT_BUSINESS_ID, ids);

      expect((service as any).repository.setActiveStatus).toHaveBeenCalledWith(
        ids,
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        false,
        undefined,
      );
      expect(upsertSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [],
        undefined,
      );
    });
  });

  describe("reactivateStockMovements", () => {
    it("marca is_active = true em lote e recalcula a cadeia via upsert", async () => {
      const upsertSpy = jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue([] as any);

      const ids = ["mov-1"];
      await service.reactivateStockMovements(PRODUCT_ID, UNIT_BUSINESS_ID, ids);

      expect((service as any).repository.setActiveStatus).toHaveBeenCalledWith(
        ids,
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        true,
        undefined,
      );
      expect(upsertSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        [],
        undefined,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // findStockMovementSourceData
  // ══════════════════════════════════════════════════════════════════════════

  describe("findStockMovementSourceData", () => {
    it("lança erro se a unit business não for encontrada", async () => {
      (UnitBusiness.findByPk as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findStockMovementSourceData(UNIT_BUSINESS_ID, PRODUCT_ID),
      ).rejects.toThrow("Unit business não encontrada!");
    });

    it("retorna [] quando não há invoice items para o produto", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([]);
      expect(Invoice.findAll).not.toHaveBeenCalled();
    });

    it("retorna [] quando nenhuma invoice é encontrada para os invoice items", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([]);
    });

    it("ignora invoices sem emitted_at e retorna [] se nenhuma sobrar", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({ emitted_at: null }),
      ]);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("sem emitted_at"),
      );

      warnSpy.mockRestore();
    });

    it("classifica invoice OUTGOING como SALE_OUT (mesmo sem fiscal item, unit_cost = 0)", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({
          unitBusinessAttributes: [
            { unit_business_id: UNIT_BUSINESS_ID, type: "OUTGOING" },
          ],
        }),
      ]);
      (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([
        expect.objectContaining({
          movement_type: "SALE_OUT",
          movement_quantity: 10,
          unit_cost_invoice: 0,
        }),
      ]);
    });

    it("classifica invoice INCOMING com sender diferente da unit business como PURCHASE_ENTRY", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({ sender_cnpj: "FORNECEDOR-CNPJ" }),
      ]);
      (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([
        makeFiscalItem({ unit_price: 25 }),
      ]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([
        expect.objectContaining({
          movement_type: "PURCHASE_ENTRY",
          unit_cost_invoice: 25,
        }),
      ]);
    });

    it("classifica invoice INCOMING com sender igual ao CNPJ da unit business como CUSTOMER_RETURN", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({ sender_cnpj: UNIT_BUSINESS_CNPJ }),
      ]);
      (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([
        makeFiscalItem(),
      ]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result[0].movement_type).toBe("CUSTOMER_RETURN");
    });

    it("ignora invoice cujo unitBusinessAttributes não corresponde à unit business informada", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({
          unitBusinessAttributes: [
            { unit_business_id: "outra-ub", type: "INCOMING" },
          ],
        }),
      ]);

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([]);
    });

    it("ignora item PURCHASE_ENTRY sem unit_price no fiscal item (loga warning)", async () => {
      (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([
        makeInvoiceItem(),
      ]);
      (Invoice.findAll as jest.Mock).mockResolvedValue([
        makeInvoice({ sender_cnpj: "FORNECEDOR-CNPJ" }),
      ]);
      (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([
        makeFiscalItem({ unit_price: null }),
      ]);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = await service.findStockMovementSourceData(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
      );

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("PURCHASE_ENTRY sem custo definido"),
      );

      warnSpy.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // syncProductStockMovements
  // ══════════════════════════════════════════════════════════════════════════

  describe("syncProductStockMovements", () => {
    it("consulta a fonte somente após a última extração de CSV", async () => {
      const extractionDate = new Date("2026-01-31T23:59:59Z");
      (stockMovementSourceDataService.findOne as jest.Mock).mockResolvedValue({
        extraction_date: extractionDate,
      });
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);
      const sourceSpy = jest
        .spyOn(service, "findStockMovementSourceData")
        .mockResolvedValue([]);

      await service.syncProductStockMovements(PRODUCT_ID, UNIT_BUSINESS_ID);

      expect(sourceSpy).toHaveBeenCalledWith(
        UNIT_BUSINESS_ID,
        PRODUCT_ID,
        undefined,
        extractionDate,
      );
    });

    it("retorna average_cost 0 e created 0 quando não há sourceData nem histórico", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({
        average_cost: 0,
        created: 0,
        balance_quantity: 0,
      });
    });

    it("retorna o CMP do último movimento existente quando não há sourceData", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        { resulting_average_cost: 42, balance_quantity: 5 },
      ]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({
        average_cost: 42,
        created: 0,
        balance_quantity: 5,
      });
    });

    it("retorna created 0 quando todas as NFs do sourceData já foram registradas", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1",
          invoice_number: "1",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        {
          invoice_id: "inv-1",
          resulting_average_cost: 10,
          balance_quantity: 8,
          movement_date: new Date("2026-01-01"),
        },
      ]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({
        average_cost: 10,
        created: 0,
        balance_quantity: 8,
      });
      expect((service as any).repository.bulkCreate).not.toHaveBeenCalled();
    });

    it("não duplica NF já consolidada pelo CSV sem invoice_id", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1",
          invoice_number: "000123",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        {
          invoice_id: null,
          invoice_number: "123",
          movement_type: "PURCHASE_ENTRY",
          status: "SYNCHED",
          resulting_average_cost: 10,
          balance_quantity: 10,
          movement_date: new Date("2026-01-01"),
        },
      ]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({
        average_cost: 10,
        created: 0,
        balance_quantity: 10,
      });
      expect((service as any).repository.bulkCreate).not.toHaveBeenCalled();
    });

    it("não considera ajuste manual SYNCHED como NF já consolidada", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1",
          invoice_number: "123",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        {
          invoice_id: null,
          invoice_number: "123",
          movement_type: "MANUAL_ADJUSTMENT",
          status: "SYNCHED",
          resulting_average_cost: 0,
          balance_quantity: 0,
          movement_date: new Date("2025-12-31"),
        },
      ]);
      (service as any).repository.bulkCreate.mockResolvedValue([{}]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result.created).toBe(1);
      expect((service as any).repository.bulkCreate).toHaveBeenCalled();
    });

    it("cria apenas os movimentos pendentes, encadeando a partir do último estado salvo (caso normal), com is_active true", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-2",
          invoice_number: "2",
          movement_type: "SALE_OUT",
          movement_date: new Date("2026-02-01"),
          movement_quantity: 3,
          unit_cost_invoice: 0,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        {
          invoice_id: "inv-1",
          balance_quantity: 10,
          resulting_average_cost: 10,
          movement_date: new Date("2026-01-01"),
        },
      ]);

      const upsertSpy = jest.spyOn(service, "upsertProductStockMovements");

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(upsertSpy).not.toHaveBeenCalled();
      expect((service as any).repository.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            invoice_id: "inv-2",
            balance_quantity: 7,
            resulting_average_cost: 10,
            is_active: true,
          }),
        ],
        { transaction: undefined },
      );
      expect(result).toEqual({
        average_cost: 10,
        created: 1,
        balance_quantity: 7,
      });
    });

    it("delega para upsertProductStockMovements (não mais reindexProduct) quando a NF pendente é retroativa", async () => {
      const existingMovement = {
        invoice_id: "inv-2",
        invoice_number: "2",
        movement_type: "SALE_OUT",
        movement_date: new Date("2026-02-01"),
        movement_quantity: 3,
        balance_quantity: 7,
        resulting_average_cost: 10,
        unit_cost_invoice: null,
      };

      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-1", // NF retroativa: data anterior ao último movimento
          invoice_number: "1",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        existingMovement,
      ]);

      const upsertedResult = [
        { resulting_average_cost: 10, balance_quantity: 12 },
        { resulting_average_cost: 12, balance_quantity: 15 },
      ];
      const upsertSpy = jest
        .spyOn(service, "upsertProductStockMovements")
        .mockResolvedValue(upsertedResult as any);
      const reindexSpy = jest.spyOn(service, "reindexProduct");

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(reindexSpy).not.toHaveBeenCalled();
      expect(upsertSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        expect.arrayContaining([
          expect.objectContaining({ invoice_id: "inv-1" }),
        ]),
        undefined,
      );
      expect(result).toEqual({
        average_cost: 12,
        created: 1,
        balance_quantity: 15,
      });

      warnSpy.mockRestore();
    });
  });
});
