// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

const mockTransaction = {} as any;
jest.mock("../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock(
  "../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: {
      findById: jest.fn(),
      delete: jest.fn(),
      findCascadeMatches: jest.fn(),
    },
  }),
);

jest.mock("../../invoice/invoice.service", () => ({
  __esModule: true,
  default: {
    findByIdFullForAllUnits: jest.fn(),
    updateInvoicesForAllUnitBusiness: jest.fn(),
  },
}));

jest.mock("../../../../../inventory/supplier-mapping/supplier-mapping.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));

jest.mock(
  "../../../../../handlers/tecinco/queues/helpers/product.helpers",
  () => ({
    __esModule: true,
    resolveIntegrationsIdForUnitBusiness: jest.fn(),
  }),
);

jest.mock("../../../../expedition/batch-invoices/batch-invoices.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock("../../../../expedition/batch-items/batch-items.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), increment: jest.fn() },
}));
jest.mock("../../../../expedition/batch/batch.service", () => ({
  __esModule: true,
  default: { increment: jest.fn(), update: jest.fn(), findById: jest.fn() },
}));
jest.mock(
  "../../../../expedition/batch-invoice-items/batch-invoice-items.service",
  () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn(), increment: jest.fn(), update: jest.fn() },
  }),
);

import InvoiceItems from "../invoice-items.model";
import InvoiceFiscalItem from "../../invoice-fiscal-item/invoice-fiscal-item.model";
import Product from "../../../../../inventory/products/product.model";
import unmappedInvoiceProductService from "../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import invoiceService from "../../invoice/invoice.service";
import { InvoiceItemsService } from "../invoice-items.service";

function makeInvoice(overrides: Partial<any> = {}) {
  return {
    id: "invoice-1",
    sender_cnpj: "11222333000144",
    unitBusinessAttributes: [],
    ...overrides,
  };
}

function makeUnmapped(overrides: Partial<any> = {}) {
  return {
    id: "unmapped-1",
    ean: "EAN-1",
    sku: null,
    quantity: 5,
    product_name: "Pneu Aro 14",
    ...overrides,
  };
}

describe("InvoiceItemsService.createInvoiceItemForUnmappedProducts (cascata de auto-mapeamento)", () => {
  let service: InvoiceItemsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InvoiceItemsService();

    (InvoiceItems.create as jest.Mock).mockResolvedValue({});
    (InvoiceFiscalItem.count as jest.Mock).mockResolvedValue(0);
    (InvoiceFiscalItem.upsert as jest.Mock).mockResolvedValue([{}, true]);
    (Product.findByPk as jest.Mock).mockResolvedValue({
      id: "product-1",
      productConfigs: [],
    });
    (invoiceService.updateInvoicesForAllUnitBusiness as jest.Mock).mockResolvedValue(
      undefined,
    );
    (unmappedInvoiceProductService.delete as jest.Mock).mockResolvedValue(undefined);
    (unmappedInvoiceProductService.findCascadeMatches as jest.Mock).mockResolvedValue(
      [],
    );
  });

  it("quantidade divergente: lança erro antes de criar qualquer InvoiceItem ou cascatear", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(
      makeUnmapped({ quantity: 5 }),
    );

    await expect(
      service.createInvoiceItemForUnmappedProducts(
        { product_id: "product-1", invoice_id: "invoice-1", quantity_expected: 3 },
        "EAN-1",
        "unmapped-1",
      ),
    ).rejects.toThrow(/quantidade/i);

    expect(InvoiceItems.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.findCascadeMatches).not.toHaveBeenCalled();
  });

  it("sem match na cascata: mapeia só o unmapped alvo, chama findCascadeMatches com código+CNPJ+excludeId corretos, e não processa mais nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(
      makeUnmapped(),
    );
    (invoiceService.findByIdFullForAllUnits as jest.Mock).mockResolvedValue(
      makeInvoice(),
    );
    (unmappedInvoiceProductService.findCascadeMatches as jest.Mock).mockResolvedValue(
      [],
    );

    await service.createInvoiceItemForUnmappedProducts(
      { product_id: "product-1", invoice_id: "invoice-1", quantity_expected: 5 },
      "EAN-1",
      "unmapped-1",
    );

    expect(InvoiceItems.create).toHaveBeenCalledTimes(1);
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledTimes(1);
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
    expect(unmappedInvoiceProductService.findCascadeMatches).toHaveBeenCalledWith(
      {
        supplierProductCode: "EAN-1",
        excludeId: "unmapped-1",
        senderCnpj: "11222333000144",
      },
      expect.anything(),
    );
  });

  it("com 1 match na cascata (mesmo código+CNPJ, outra nota): mapeia o alvo E o match pro MESMO product_id, apaga os dois unmapped, e a recursão do match não encontra mais nada (sem loop infinito)", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockImplementation(
      (id: string) => {
        if (id === "unmapped-1") return Promise.resolve(makeUnmapped({ id: "unmapped-1", quantity: 5 }));
        if (id === "unmapped-2")
          return Promise.resolve(
            makeUnmapped({ id: "unmapped-2", quantity: 3, invoice_id: "invoice-2" }),
          );
        return Promise.resolve(null);
      },
    );
    (invoiceService.findByIdFullForAllUnits as jest.Mock).mockImplementation(
      (invoiceId: string) => Promise.resolve(makeInvoice({ id: invoiceId })),
    );
    (unmappedInvoiceProductService.findCascadeMatches as jest.Mock)
      .mockResolvedValueOnce([
        { id: "unmapped-2", invoice_id: "invoice-2", quantity: 3, ean: "EAN-1" },
      ])
      .mockResolvedValueOnce([]); // busca da cascata do match-2 não acha mais nada

    await service.createInvoiceItemForUnmappedProducts(
      { product_id: "product-1", invoice_id: "invoice-1", quantity_expected: 5 },
      "EAN-1",
      "unmapped-1",
    );

    // Cria o InvoiceItem pra nota original E pra nota do match encontrado.
    expect(InvoiceItems.create).toHaveBeenCalledTimes(2);
    expect(InvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_id: "invoice-1", product_id: "product-1" }),
      expect.anything(),
    );
    expect(InvoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_id: "invoice-2", product_id: "product-1" }),
      expect.anything(),
    );

    // Apaga os dois unmapped resolvidos.
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledTimes(2);
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-2",
      expect.anything(),
    );

    // A cascata roda pro alvo e de novo pro match (recursivo) — sem terceira
    // chamada, já que a segunda busca não encontrou mais nada.
    expect(unmappedInvoiceProductService.findCascadeMatches).toHaveBeenCalledTimes(2);
  });

  it("com múltiplos matches na cascata: resolve TODOS pro mesmo product_id passado pela função pai", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockImplementation(
      (id: string) =>
        Promise.resolve(
          makeUnmapped({
            id,
            quantity: id === "unmapped-1" ? 5 : id === "unmapped-2" ? 2 : 7,
            invoice_id: id === "unmapped-1" ? undefined : `invoice-${id}`,
          }),
        ),
    );
    (invoiceService.findByIdFullForAllUnits as jest.Mock).mockImplementation(
      (invoiceId: string) => Promise.resolve(makeInvoice({ id: invoiceId })),
    );
    (unmappedInvoiceProductService.findCascadeMatches as jest.Mock)
      .mockResolvedValueOnce([
        { id: "unmapped-2", invoice_id: "invoice-unmapped-2", quantity: 2, ean: "EAN-1" },
        { id: "unmapped-3", invoice_id: "invoice-unmapped-3", quantity: 7, ean: "EAN-1" },
      ])
      .mockResolvedValue([]); // recursões dos dois matches não acham mais nada

    await service.createInvoiceItemForUnmappedProducts(
      { product_id: "product-1", invoice_id: "invoice-1", quantity_expected: 5 },
      "EAN-1",
      "unmapped-1",
    );

    expect(InvoiceItems.create).toHaveBeenCalledTimes(3);
    for (const call of (InvoiceItems.create as jest.Mock).mock.calls) {
      expect(call[0].product_id).toBe("product-1");
    }
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledTimes(3);
  });
});
