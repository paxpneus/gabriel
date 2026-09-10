// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

// product.helpers.ts importa integration-mapping.service (real), que por
// sua vez arrasta product.service (real) e outras dependências de
// infra/fila — mocka-se aqui, igual tecinco-api-fetch.queue.test.ts faz,
// pra não abrir conexão real nenhuma durante o teste.
jest.mock(
  "../../../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      findEntityByMapping: jest.fn(),
      createOrUpdateIntegrationMapping: jest.fn(),
      findValidExternalIdsSet: jest.fn(),
    },
  }),
);

import UnitBusiness from "../../../../../company/unit-business/unit-business.model";
import Product from "../../../../../inventory/products/product.model";
import ProductConfig from "../../../../../inventory/product-config/product_config.model";
import SupplierMapping from "../../../../../inventory/supplier-mapping/supplier-mapping.model";
import {
  ensureSupplierMappings,
  isCodeOwnedByAnotherProduct,
  SupplierMappingConflictError,
} from "../product.helpers";

const INTEGRATION_ID = "integration-1";
const UNIT_BUSINESS_ID = "ub-1";

beforeEach(() => {
  jest.clearAllMocks();
  (UnitBusiness.findByPk as jest.Mock).mockResolvedValue({
    integrations_id: INTEGRATION_ID,
  });
});

describe("ensureSupplierMappings", () => {
  it("código sem SupplierMapping existente: cria normalmente", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue(null);
    (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    await ensureSupplierMappings({
      productId: "product-1",
      supplierCnpj: "11222333000144",
      ean: "EAN-1",
      unitBusinessId: UNIT_BUSINESS_ID,
      logPrefix: "[test]",
    });

    expect(SupplierMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "product-1",
        supplier_product_code: "EAN-1",
        integrations_id: INTEGRATION_ID,
      }),
    );
  });

  it("código já mapeado pro MESMO produto: não recria (idempotente, sem erro)", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "existing-1",
      product_id: "product-1",
    });

    await ensureSupplierMappings({
      productId: "product-1",
      supplierCnpj: "11222333000144",
      ean: "EAN-1",
      unitBusinessId: UNIT_BUSINESS_ID,
      logPrefix: "[test]",
    });

    expect(SupplierMapping.create).not.toHaveBeenCalled();
  });

  it("código já mapeado pra OUTRO produto: lança SupplierMappingConflictError, não cria nada", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "existing-1",
      product_id: "other-product-id",
    });
    (Product.findByPk as jest.Mock).mockResolvedValue({ name: "Produto X" });

    await expect(
      ensureSupplierMappings({
        productId: "product-1",
        supplierCnpj: "11222333000144",
        ean: "EAN-1",
        unitBusinessId: UNIT_BUSINESS_ID,
        logPrefix: "[test]",
      }),
    ).rejects.toThrow(SupplierMappingConflictError);

    expect(SupplierMapping.create).not.toHaveBeenCalled();
  });

  it("corrida (UniqueConstraintError no create): converte pra SupplierMappingConflictError amigável", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue(null);
    const { UniqueConstraintError } = jest.requireActual("sequelize");
    (SupplierMapping.create as jest.Mock).mockRejectedValue(
      new UniqueConstraintError({}),
    );

    await expect(
      ensureSupplierMappings({
        productId: "product-1",
        supplierCnpj: "11222333000144",
        ean: "EAN-1",
        unitBusinessId: UNIT_BUSINESS_ID,
        logPrefix: "[test]",
      }),
    ).rejects.toThrow(SupplierMappingConflictError);
  });
});

describe("isCodeOwnedByAnotherProduct", () => {
  beforeEach(() => {
    (UnitBusiness.findAll as jest.Mock).mockResolvedValue([
      { id: "ub-1" },
      { id: "ub-2" },
    ]);
  });

  it("sku já existe em ProductConfig de outra unit_business da mesma integração: true", async () => {
    (ProductConfig.findOne as jest.Mock).mockResolvedValue({ id: "config-1" });

    const result = await isCodeOwnedByAnotherProduct({
      code: "SKU-1",
      field: "sku",
      integrationsId: INTEGRATION_ID,
    });

    expect(result).toBe(true);
    expect(ProductConfig.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sku: "SKU-1" }),
      }),
    );
  });

  it("não existe em ProductConfig, mas existe como SupplierMapping na integração: true", async () => {
    (ProductConfig.findOne as jest.Mock).mockResolvedValue(null);
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({ id: "mapping-1" });

    const result = await isCodeOwnedByAnotherProduct({
      code: "SKU-1",
      field: "sku",
      integrationsId: INTEGRATION_ID,
    });

    expect(result).toBe(true);
  });

  it("não existe em nenhum dos dois: false", async () => {
    (ProductConfig.findOne as jest.Mock).mockResolvedValue(null);
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue(null);

    const result = await isCodeOwnedByAnotherProduct({
      code: "SKU-1",
      field: "sku",
      integrationsId: INTEGRATION_ID,
    });

    expect(result).toBe(false);
  });
});
