import { StockMovementService } from "./../stock-movements.service";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../warehouse", () => ({
  __esModule: true,
  Invoice: { findAll: jest.fn() },
  InvoiceItems: {},
  UnitBusiness: { findByPk: jest.fn() },
}));

jest.mock(
  "../../../../warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model",
  () => ({
    __esModule: true,
    default: { findAll: jest.fn() },
  }),
);

jest.mock(
  "../../../../warehouse/invoices/invoice-items/invoice-items.service",
  () => ({
    __esModule: true,
    default: { findAll: jest.fn() },
  }),
);

jest.mock(
  "../../../../warehouse/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model",
  () => ({
    __esModule: true,
    default: {},
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
    create: jest.fn(),
    bulkCreate: jest.fn(),
    bulkDelete: jest.fn(),
  },
}));

import { Invoice, UnitBusiness } from "../../../../warehouse";
import InvoiceFiscalItem from "../../../../warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceItemsService from "../../../../warehouse/invoices/invoice-items/invoice-items.service";

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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("StockMovementService", () => {
  let service: StockMovementService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StockMovementService();

    // Repositório interno do service
    (service as any).repository = {
      findLastMovement: jest.fn(),
      findHistoryByProduct: jest.fn().mockResolvedValue([]),
      bulkCreate: jest
        .fn()
        .mockImplementation((rows: any[]) => Promise.resolve(rows)),
      bulkDelete: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    };

    (UnitBusiness.findByPk as jest.Mock).mockResolvedValue(mockUnitBusiness);
    (invoiceItemsService.findAll as jest.Mock).mockResolvedValue([]);
    (Invoice.findAll as jest.Mock).mockResolvedValue([]);
    (InvoiceFiscalItem.findAll as jest.Mock).mockResolvedValue([]);
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
      // anterior: 10 un a custo médio 10 (valor total = 100)
      // entrada: 10 un a custo 20 (valor entrada = 200)
      // novo total = 300 / 20 un = 15
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
          unit_cost_invoice: 999, // não deve influenciar
        },
      );

      expect(result).toEqual({
        balance_quantity: 6,
        resulting_average_cost: 15,
        total_stock_value: 90,
      });
    });

    it("SALE_OUT: permite saldo negativo (não há trava aqui, é responsabilidade de outra camada)", () => {
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
          unit_cost_invoice: 999, // não deve influenciar
        },
      );

      expect(result).toEqual({
        balance_quantity: 8,
        resulting_average_cost: 15,
        total_stock_value: 120,
      });
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

    it("ordena os movimentos por data antes de processar, independente da ordem de entrada", async () => {
      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];

      expect(created[0].invoice_id).toBe("inv-1"); // entrada, mais antiga, processada primeiro
      expect(created[1].invoice_id).toBe("inv-2"); // saída, processada depois
    });

    it("calcula o estado encadeado corretamente (entrada seguida de saída)", async () => {
      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      const created = (service as any).repository.bulkCreate.mock.calls[0][0];

      expect(created[0]).toMatchObject({
        balance_quantity: 10,
        resulting_average_cost: 10,
      });
      expect(created[1]).toMatchObject({
        balance_quantity: 7,
        resulting_average_cost: 10,
      });
    });

    it("remove o histórico existente antes de recriar, quando já existem movimentos", async () => {
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        { id: "old-1" },
      ]);

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect((service as any).repository.bulkDelete).toHaveBeenCalledWith({
        where: { product_id: PRODUCT_ID, unit_business_id: UNIT_BUSINESS_ID },
      });
    });

    it("NÃO chama bulkDelete quando não há histórico existente", async () => {
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect((service as any).repository.bulkDelete).not.toHaveBeenCalled();
    });

    it("retorna o resultado de bulkCreate", async () => {
      const fakeCreated = [{ id: "new-1" }, { id: "new-2" }];
      (service as any).repository.bulkCreate.mockResolvedValue(fakeCreated);

      const result = await service.reindexProduct(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        movements as any,
      );

      expect(result).toEqual(fakeCreated);
    });

    it("no caso retroativo, inclui TODOS os movimentos existentes (não só o mais recente) junto com os pendentes", async () => {
      const existingMovements = [
        {
          invoice_id: "inv-1",
          invoice_number: "1",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2026-01-01"),
          movement_quantity: 10,
          unit_cost_invoice: 10,
          balance_quantity: 10,
          resulting_average_cost: 10,
        },
        {
          invoice_id: "inv-2",
          invoice_number: "2",
          movement_type: "SALE_OUT",
          movement_date: new Date("2026-02-01"),
          movement_quantity: 3,
          unit_cost_invoice: null,
          balance_quantity: 7,
          resulting_average_cost: 10,
        },
        {
          invoice_id: "inv-3",
          invoice_number: "3",
          movement_type: "CUSTOMER_RETURN",
          movement_date: new Date("2026-03-01"),
          movement_quantity: 2,
          unit_cost_invoice: null,
          balance_quantity: 9,
          resulting_average_cost: 10,
        },
      ];

      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-0", // retroativa: anterior a TODOS os existentes
          invoice_number: "0",
          movement_type: "PURCHASE_ENTRY",
          movement_date: new Date("2025-12-01"),
          movement_quantity: 5,
          unit_cost_invoice: 8,
        },
      ]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue(
        existingMovements,
      );

      const reindexSpy = jest
        .spyOn(service, "reindexProduct")
        .mockResolvedValue([{ resulting_average_cost: 9 }] as any);

      jest.spyOn(console, "warn").mockImplementation(() => {});

      await service.syncProductStockMovements(PRODUCT_ID, UNIT_BUSINESS_ID);

      const allMovementsPassed = reindexSpy.mock.calls[0][2];

      expect(allMovementsPassed).toHaveLength(4);
      expect(allMovementsPassed.map((m: any) => m.invoice_id).sort()).toEqual([
        "inv-0",
        "inv-1",
        "inv-2",
        "inv-3",
      ]);
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
    it("retorna average_cost 0 e created 0 quando não há sourceData nem histórico", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({ average_cost: 0, created: 0 });
    });

    it("retorna o CMP do último movimento existente quando não há sourceData", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([]);
      (service as any).repository.findHistoryByProduct.mockResolvedValue([
        { resulting_average_cost: 42 },
      ]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({ average_cost: 42, created: 0 });
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
          movement_date: new Date("2026-01-01"),
        },
      ]);

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(result).toEqual({ average_cost: 10, created: 0 });
      expect((service as any).repository.bulkCreate).not.toHaveBeenCalled();
    });

    it("cria apenas os movimentos pendentes, encadeando a partir do último estado salvo (caso normal)", async () => {
      jest.spyOn(service, "findStockMovementSourceData").mockResolvedValue([
        {
          product_id: PRODUCT_ID,
          invoice_id: "inv-2",
          invoice_number: "2",
          movement_type: "SALE_OUT",
          movement_date: new Date("2026-02-01"), // posterior ao último existente
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

      const reindexSpy = jest.spyOn(service, "reindexProduct");

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(reindexSpy).not.toHaveBeenCalled();
      expect((service as any).repository.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            invoice_id: "inv-2",
            balance_quantity: 7,
            resulting_average_cost: 10,
          }),
        ],
        { transaction: undefined },
      );
      expect(result).toEqual({ average_cost: 10, created: 1 });
    });

    it("delega para reindexProduct quando a NF pendente é retroativa (anterior ao último movimento gravado)", async () => {
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

      const reindexedResult = [
        { resulting_average_cost: 10 },
        { resulting_average_cost: 12 },
      ];
      const reindexSpy = jest
        .spyOn(service, "reindexProduct")
        .mockResolvedValue(reindexedResult as any);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const result = await service.syncProductStockMovements(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
      );

      expect(reindexSpy).toHaveBeenCalledWith(
        PRODUCT_ID,
        UNIT_BUSINESS_ID,
        expect.arrayContaining([
          expect.objectContaining({ invoice_id: "inv-2" }),
          expect.objectContaining({ invoice_id: "inv-1" }),
        ]),
        undefined,
      );
      expect(result).toEqual({ average_cost: 12, created: 1 });

      warnSpy.mockRestore();
    });
  });
});
