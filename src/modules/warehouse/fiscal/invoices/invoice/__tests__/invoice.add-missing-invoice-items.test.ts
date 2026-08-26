import { ItemWithFiscal } from "../invoice.types";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

const fakeTransaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn().mockResolvedValue(fakeTransaction),
    where: jest.fn(),
    fn: jest.fn(),
    col: jest.fn(),
    define: jest.fn(() => class {}),
    authenticate: jest.fn(),
    sync: jest.fn(),
    query: jest.fn(),
    close: jest.fn(),
    getQueryInterface: jest.fn(),
    models: {},
    modelManager: { addModel: jest.fn(), getModel: jest.fn() },
    literal: jest.fn((value: string) => value),
  },
}));

jest.mock("../invoice.repository", () => ({
  __esModule: true,
  default: {
    createInvoiceItems: jest.fn(),
    createInvoiceFiscalItems: jest.fn(),
  },
}));

jest.mock("../../../../../company/events/event/event.service", () => ({
  __esModule: true,
  default: {
    notifyByRoles: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    notifyByRoles: jest.fn().mockResolvedValue(undefined),
  },
}));

import sequelize from "../../../../../../config/sequelize";
import mockedRepository from "../invoice.repository";
import invoiceService from "../invoice.service";
import InvoiceItems from "../../invoice-items/invoice-items.model";

const repo = mockedRepository as unknown as {
  createInvoiceItems: jest.Mock;
  createInvoiceFiscalItems: jest.Mock;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INVOICE_ID = "invoice-1";

const makeItem = (
  overrides: Partial<ItemWithFiscal> = {},
): ItemWithFiscal => ({
  product_id: "prod-1",
  quantity_expected: 2,
  fiscal: undefined,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();

  (sequelize.transaction as jest.Mock).mockResolvedValue(fakeTransaction);
  (InvoiceItems.findAll as jest.Mock).mockResolvedValue([]);
  repo.createInvoiceItems.mockResolvedValue(undefined);
  repo.createInvoiceFiscalItems.mockResolvedValue(undefined);
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("InvoiceService.addMissingInvoiceItems", () => {
  it("retorna [] e não toca no banco quando items está vazio", async () => {
    const result = await invoiceService.addMissingInvoiceItems(
      INVOICE_ID,
      [],
    );

    expect(result).toEqual([]);
    expect(InvoiceItems.findAll).not.toHaveBeenCalled();
    expect(repo.createInvoiceItems).not.toHaveBeenCalled();
  });

  it("cria só os itens cujo product_id ainda não tem InvoiceItems pra essa invoice", async () => {
    (InvoiceItems.findAll as jest.Mock).mockResolvedValue([
      { product_id: "prod-1" },
    ]);

    const result = await invoiceService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1" }), // já existe — deve ser ignorado
      makeItem({ product_id: "prod-2" }), // novo — deve ser criado
    ]);

    expect(result).toEqual(["prod-2"]);
    const createdItems = repo.createInvoiceItems.mock.calls[0][0];
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]).toMatchObject({
      product_id: "prod-2",
      invoice_id: INVOICE_ID,
    });
  });

  it("quando todos os itens já existem, não chama createInvoiceItems/createInvoiceFiscalItems e retorna []", async () => {
    (InvoiceItems.findAll as jest.Mock).mockResolvedValue([
      { product_id: "prod-1" },
    ]);

    const result = await invoiceService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1" }),
    ]);

    expect(result).toEqual([]);
    expect(repo.createInvoiceItems).not.toHaveBeenCalled();
    expect(repo.createInvoiceFiscalItems).not.toHaveBeenCalled();
  });

  it("deduplica itens novos com mesmo product_id somando quantity_expected", async () => {
    const result = await invoiceService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1", quantity_expected: 2.4 }),
      makeItem({ product_id: "prod-1", quantity_expected: 1.4 }),
    ]);

    expect(result).toEqual(["prod-1"]);
    const createdItems = repo.createInvoiceItems.mock.calls[0][0];
    expect(createdItems).toHaveLength(1);
    // Math.trunc(2.4 + 1.4) = Math.trunc(3.8) = 3
    expect(createdItems[0].quantity_expected).toBe(3);
  });

  it("só cria InvoiceFiscalItem pros itens que trazem fiscal", async () => {
    await invoiceService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1", fiscal: undefined }),
      makeItem({
        product_id: "prod-2",
        fiscal: { product_id: "prod-2", item_number: 1 } as any,
      }),
    ]);

    const fiscalItems = repo.createInvoiceFiscalItems.mock.calls[0][0];
    expect(fiscalItems).toHaveLength(1);
    expect(fiscalItems[0]).toMatchObject({
      product_id: "prod-2",
      invoice_id: INVOICE_ID,
    });
  });

  describe("transação", () => {
    it("usa transação externa quando fornecida e não faz commit/rollback próprio", async () => {
      const externalTx = { commit: jest.fn(), rollback: jest.fn() };

      await invoiceService.addMissingInvoiceItems(
        INVOICE_ID,
        [makeItem({ product_id: "prod-2" })],
        externalTx as any,
      );

      expect(externalTx.commit).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it("cria e comita própria transação quando nenhuma é fornecida", async () => {
      await invoiceService.addMissingInvoiceItems(INVOICE_ID, [
        makeItem({ product_id: "prod-2" }),
      ]);

      expect(fakeTransaction.commit).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.rollback).not.toHaveBeenCalled();
    });

    it("faz rollback da própria transação se algo falhar, e propaga o erro", async () => {
      repo.createInvoiceItems.mockRejectedValue(new Error("db error"));

      await expect(
        invoiceService.addMissingInvoiceItems(INVOICE_ID, [
          makeItem({ product_id: "prod-2" }),
        ]),
      ).rejects.toThrow("db error");

      expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.commit).not.toHaveBeenCalled();
    });
  });
});
