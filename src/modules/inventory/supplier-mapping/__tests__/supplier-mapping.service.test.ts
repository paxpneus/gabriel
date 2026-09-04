// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

const mockTransaction = {} as any;
jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock(
  "../../unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: { findById: jest.fn(), delete: jest.fn() },
  }),
);

jest.mock(
  "../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: { createOrUpdateIntegrationMapping: jest.fn() },
  }),
);

import SupplierMapping from "../supplier-mapping.model";
import unmappedInvoiceProductService from "../../unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";
import { SupplierMappingService } from "../supplier-mapping.service";

describe("SupplierMappingService.createFromUnmapped", () => {
  let service: SupplierMappingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupplierMappingService();
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue(null);
  });

  it("unmapped não encontrado: lança erro, não cria mapping nem apaga nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/não encontrado/i);

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  it("unmapped sem ean/sku: lança erro claro, não cria mapping nem apaga nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: null,
      sku: null,
      integrations_id: "integration-1",
    });

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/EAN\/SKU/i);

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  it("unmapped sem integrations_id: lança erro claro, não cria mapping nem apaga nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: null,
      integrations_id: null,
    });

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/integração/i);

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  it("caminho feliz: cria o SupplierMapping com o ean (prioridade sobre sku) do unmapped e apaga o unmapped em seguida", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: "SKU-1",
      integrations_id: "integration-1",
    });
    (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    const result = await service.createFromUnmapped({
      productId: "product-1",
      unmappedInvoiceProductId: "unmapped-1",
      supplierCnpj: "11222333000144",
    });

    expect(SupplierMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "product-1",
        supplier_cnpj: "11222333000144",
        supplier_product_code: "EAN-1",
        integrations_id: "integration-1",
      }),
      expect.anything(),
    );
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
    expect(result).toEqual({ id: "mapping-1" });
    // Sem external_id no unmapped (unmapped de nota, não de catálogo) —
    // não há id de ERP conhecido pra vincular, então não mexe em mapping.
    expect(
      integrationMappingService.createOrUpdateIntegrationMapping,
    ).not.toHaveBeenCalled();
  });

  it("unmapped de catálogo com external_id: também garante o IntegrationMapping do produto pro external_id do unmapped", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: "SKU-1",
      integrations_id: "integration-1",
      external_id: "90001",
    });
    (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    await service.createFromUnmapped({
      productId: "product-1",
      unmappedInvoiceProductId: "unmapped-1",
    });

    expect(
      integrationMappingService.createOrUpdateIntegrationMapping,
    ).toHaveBeenCalledWith(
      {
        entity_type: "PRODUCT",
        internal_id: "product-1",
        integrations_id: "integration-1",
        external_id: "90001",
      },
      expect.anything(),
    );
  });

  it("unmapped sem ean (só sku): usa o sku como supplier_product_code", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: null,
      sku: "SKU-1",
      integrations_id: "integration-1",
    });
    (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    await service.createFromUnmapped({
      productId: "product-1",
      unmappedInvoiceProductId: "unmapped-1",
    });

    expect(SupplierMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({ supplier_product_code: "SKU-1" }),
      expect.anything(),
    );
  });

  it("código já mapeado nessa integração (UniqueConstraintError): propaga mensagem amigável, não apaga o unmapped", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: null,
      integrations_id: "integration-1",
    });
    const { UniqueConstraintError } = jest.requireActual("sequelize");
    (SupplierMapping.create as jest.Mock).mockRejectedValue(
      new UniqueConstraintError({}),
    );

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/já existe um SupplierMapping/i);

    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  it("mapping já existe pro MESMO produto (idempotente): não é erro — não recria, mas ainda garante o IntegrationMapping e apaga o unmapped", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: null,
      integrations_id: "integration-1",
      external_id: "90001",
    });
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "existing-mapping-1",
      product_id: "product-1",
    });

    const result = await service.createFromUnmapped({
      productId: "product-1",
      unmappedInvoiceProductId: "unmapped-1",
    });

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "existing-mapping-1", product_id: "product-1" });
    expect(
      integrationMappingService.createOrUpdateIntegrationMapping,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ internal_id: "product-1" }),
      expect.anything(),
    );
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
  });

  it("mapping já existe pra um produto DIFERENTE: é conflito de verdade — lança erro específico, não cria mapping nem apaga o unmapped", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: null,
      integrations_id: "integration-1",
    });
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "existing-mapping-1",
      product_id: "other-product-id",
    });

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/mapeado para outro produto.*other-product-id/i);

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(
      integrationMappingService.createOrUpdateIntegrationMapping,
    ).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });
});
