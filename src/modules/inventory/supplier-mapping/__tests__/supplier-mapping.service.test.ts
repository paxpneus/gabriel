// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

const mockTransaction = {} as any;
jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  // Aceita (cb) e (options, cb) — o segundo é o savepoint do DE x PARA no createFromUnmapped.
  default: { transaction: jest.fn((...args: any[]) => args[args.length - 1](mockTransaction)) },
}));

jest.mock(
  "../../unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: { findById: jest.fn(), delete: jest.fn(), resolveFromCreatedProduct: jest.fn() },
  }),
);

jest.mock(
  "../../../integrations/integration-mapping/integration-mapping.service",
  () => ({
    __esModule: true,
    default: {
      createOrUpdateIntegrationMapping: jest.fn(),
      findExternalIdsMap: jest.fn(),
      findProductMappingsInIntegration: jest.fn(),
    },
  }),
);

jest.mock("../../../integrations/integrations/integrations.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { getMe: jest.fn() },
}));

import { Op } from "sequelize";
import SupplierMapping from "../supplier-mapping.model";
import ProductConfig from "../../product-config/product_config.model";
import AuditLog from "../../../global/audit-logs/audit-log.model";
import { SupplierMappingError, SupplierMappingErrorCode } from "../supplier-mapping.types";
import userService from "../../../company/users/users/user.service";
import unmappedInvoiceProductService from "../../unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { SupplierMappingService } from "../supplier-mapping.service";

describe("SupplierMappingService.createFromUnmapped", () => {
  let service: SupplierMappingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupplierMappingService();
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue(null);
    // Pré-check de EAN (findEanOwners): por padrão nenhum outro produto usa o código.
    (SupplierMapping.findAll as jest.Mock).mockResolvedValue([]);
    (ProductConfig.findAll as jest.Mock).mockResolvedValue([]);
    (AuditLog.findAll as jest.Mock).mockResolvedValue([]);
    (integrationsService.findById as jest.Mock).mockResolvedValue({ id: "integration-1", name: "Tecinco" });
    // Por padrão o produto já está mapeado na integração (fluxo antigo, erro do DE x PARA propaga).
    (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(new Map([["product-1", "80001"]]));
    (integrationMappingService.findProductMappingsInIntegration as jest.Mock).mockResolvedValue([]);
    (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockImplementation(async (dto: any) => ({
      id: "im-new",
      internal_id: dto.internal_id,
      external_id: dto.external_id,
      is_primary: false,
    }));
  });

  it("EAN físico confirmado de outro produto (mesmo com zero à esquerda): erro EAN_HAS_PHYSICAL_OVERRIDE, não cria nem apaga nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "07891234567895",
      sku: null,
      integrations_id: "integration-1",
    });
    (SupplierMapping.findAll as jest.Mock).mockResolvedValue([
      {
        id: "override-1",
        product_id: "other-product-id",
        supplier_product_code: "7891234567895",
        is_physical_override: true,
        product: { name: "Pneu Certo" },
      },
    ]);

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toMatchObject({
      code: SupplierMappingErrorCode.EAN_HAS_PHYSICAL_OVERRIDE,
      override: expect.objectContaining({ product_id: "other-product-id" }),
    });

    // Busca o exato e as variações de zero, só de OUTROS produtos.
    expect(SupplierMapping.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          supplier_product_code: { [Op.in]: expect.arrayContaining(["07891234567895", "7891234567895"]) },
          product_id: { [Op.ne]: "product-1" },
        }),
      }),
    );
    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  it("EAN em uso por outro produto (gtin numa loja da integração): erro EAN_OWNED_BY_ANOTHER_PRODUCT com os donos, não cria nem apaga nada", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "7891234567895",
      sku: null,
      integrations_id: "integration-1",
    });
    (ProductConfig.findAll as jest.Mock).mockResolvedValue([
      {
        id: "config-1",
        product_id: "other-product-id",
        unit_business_id: "ub-1",
        gtin: "07891234567895",
        product: { name: "Pneu Errado" },
        unitBusiness: { name: "Loja 12" },
      },
    ]);

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toMatchObject({
      code: SupplierMappingErrorCode.EAN_OWNED_BY_ANOTHER_PRODUCT,
      owners: [
        expect.objectContaining({
          product_id: "other-product-id",
          source: "PRODUCT_CONFIG",
          unit_business_name: "Loja 12",
        }),
      ],
    });

    expect(SupplierMapping.create).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
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
        // Mapeamento a partir do não mapeado sempre vira EAN físico confirmado.
        is_physical_override: true,
      }),
      expect.anything(),
    );
    // Quem/quando do EAN físico confirmado: log do DE x PARA e do produto.
    expect(AuditLog.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ entity: "SUPPLIER_MAPPING", internal_id: "mapping-1", action: "CREATE" }),
        expect.objectContaining({ entity: "PRODUCT", internal_id: "product-1" }),
      ]),
      expect.anything(),
    );
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
    expect(result).toEqual({
      supplierMapping: { id: "mapping-1" },
      integrationMapping: null,
      integration: { id: "integration-1", name: "Tecinco" },
      integrationMappings: [],
    });
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

  it("mapping já existe pro MESMO produto (idempotente): não recria, marca como EAN físico confirmado, ainda garante o IntegrationMapping e apaga o unmapped", async () => {
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
    expect(SupplierMapping.update).toHaveBeenCalledWith(
      { is_physical_override: true },
      expect.objectContaining({ where: { id: "existing-mapping-1" } }),
    );
    expect(result.supplierMapping).toEqual({
      id: "existing-mapping-1",
      product_id: "product-1",
      is_physical_override: true,
    });
    expect(result.integrationMapping).toEqual({ id: "im-new", external_id: "90001", is_primary: false });
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

  it("unmapped ERROR_CATALOG_DUPLICATE: só cria o integration_mapping (código ambíguo, não tenta SupplierMapping), apaga o unmapped e retorna null", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: "SKU-1",
      integrations_id: "integration-1",
      external_id: "90001",
      type: "ERROR_CATALOG_DUPLICATE",
    });

    const result = await service.createFromUnmapped({
      productId: "product-1",
      unmappedInvoiceProductId: "unmapped-1",
    });

    expect(SupplierMapping.findOne).not.toHaveBeenCalled();
    expect(SupplierMapping.create).not.toHaveBeenCalled();
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
    expect(unmappedInvoiceProductService.delete).toHaveBeenCalledWith(
      "unmapped-1",
      expect.anything(),
    );
    expect(result.supplierMapping).toBeNull();
  });

  it("unmapped ERROR_CATALOG_DUPLICATE sem external_id: lança erro claro, não cria nada nem apaga o unmapped", async () => {
    (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
      id: "unmapped-1",
      ean: "EAN-1",
      sku: "SKU-1",
      integrations_id: "integration-1",
      external_id: null,
      type: "ERROR_CATALOG_DUPLICATE",
    });

    await expect(
      service.createFromUnmapped({
        productId: "product-1",
        unmappedInvoiceProductId: "unmapped-1",
      }),
    ).rejects.toThrow(/duplicado sem integrations_id\/external_id/i);

    expect(
      integrationMappingService.createOrUpdateIntegrationMapping,
    ).not.toHaveBeenCalled();
    expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
  });

  describe("produto escolhido sem mapping na integração do não mapeado", () => {
    const catalogUnmapped = {
      id: "unmapped-1",
      ean: "7891234567895",
      sku: null,
      integrations_id: "integration-1",
      external_id: "90001",
      type: "ERROR_CATALOG",
      reason: "Produto novo, precisa de mapeamento manual",
      invoice_id: null,
    };

    beforeEach(() => {
      (integrationMappingService.findExternalIdsMap as jest.Mock).mockResolvedValue(new Map());
      (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockImplementation(async (dto: any) => ({
        id: "im-new",
        internal_id: dto.internal_id,
        external_id: dto.external_id,
        is_primary: true,
      }));
    });

    it("ERROR_CATALOG produto novo com external_id: cria o mapping (principal), o DE x PARA e resolve as linhas do external_id", async () => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(catalogUnmapped);
      (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });
      (integrationMappingService.findProductMappingsInIntegration as jest.Mock).mockResolvedValue([
        { id: "im-new", external_id: "90001", is_primary: true, erp_data: { name: "Pneu", ean: "7891234567895" } },
      ]);

      const result = await service.createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" });

      expect(integrationMappingService.createOrUpdateIntegrationMapping).toHaveBeenCalledWith(
        { entity_type: "PRODUCT", internal_id: "product-1", integrations_id: "integration-1", external_id: "90001" },
        expect.anything(),
      );
      expect(SupplierMapping.create).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_product_code: "7891234567895", is_physical_override: true }),
        expect.anything(),
      );
      // Resolve depois do commit (linha de nota ganha o item); a linha não é apagada na transação.
      expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
      expect(unmappedInvoiceProductService.resolveFromCreatedProduct).toHaveBeenCalledWith({
        externalId: "90001",
        integrationsId: "integration-1",
        productId: "product-1",
      });
      // Vínculo novo auditado (mapeamento de integração + produto).
      expect(AuditLog.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ entity: "INTEGRATION_MAPPING", internal_id: "im-new", action: "CREATE" }),
        ]),
        expect.anything(),
      );
      expect(result).toEqual({
        supplierMapping: { id: "mapping-1" },
        integrationMapping: { id: "im-new", external_id: "90001", is_primary: true },
        integration: { id: "integration-1", name: "Tecinco" },
        integrationMappings: [
          { id: "im-new", external_id: "90001", is_primary: true, erp_data: { name: "Pneu", ean: "7891234567895" } },
        ],
      });
    });

    it("produto da nota sem cadastro (Tecinco) com external_id: também vincula", async () => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({
        ...catalogUnmapped,
        invoice_id: "invoice-1",
        reason: "Produto Tecinco presente na nota mas sem produto correspondente no banco",
      });
      (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });

      const result = await service.createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" });

      expect(result.integrationMapping).toEqual({ id: "im-new", external_id: "90001", is_primary: true });
      expect(unmappedInvoiceProductService.resolveFromCreatedProduct).toHaveBeenCalled();
    });

    it("EAN em uso por outro produto: não é erro — só não cria o DE x PARA, vincula e resolve mesmo assim", async () => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(catalogUnmapped);
      (ProductConfig.findAll as jest.Mock).mockResolvedValue([
        { id: "config-1", product_id: "other-product-id", unit_business_id: "ub-1", gtin: "7891234567895" },
      ]);

      const result = await service.createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" });

      expect(SupplierMapping.create).not.toHaveBeenCalled();
      expect(result.supplierMapping).toBeNull();
      expect(result.integrationMapping).toEqual({ id: "im-new", external_id: "90001", is_primary: true });
      expect(unmappedInvoiceProductService.resolveFromCreatedProduct).toHaveBeenCalled();
    });

    it("já existe principal na integração: o novo mapping vem como não principal (createOrUpdateIntegrationMapping decide)", async () => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({ ...catalogUnmapped, ean: null, sku: null });
      (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockResolvedValue({
        id: "im-new",
        internal_id: "product-1",
        external_id: "90001",
        is_primary: false,
      });

      const result = await service.createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" });

      // Sem EAN/SKU: DE x PARA não sai, mas não é erro nesse fluxo.
      expect(result.supplierMapping).toBeNull();
      expect(result.integrationMapping).toEqual({ id: "im-new", external_id: "90001", is_primary: false });
    });

    it("código do ERP já vinculado a outro produto: erro, nada é resolvido", async () => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue(catalogUnmapped);
      (SupplierMapping.create as jest.Mock).mockResolvedValue({ id: "mapping-1" });
      (integrationMappingService.createOrUpdateIntegrationMapping as jest.Mock).mockResolvedValue({
        id: "im-other",
        internal_id: "other-product-id",
        external_id: "90001",
        is_primary: true,
      });

      await expect(
        service.createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" }),
      ).rejects.toThrow(/já está vinculado a outro produto/i);
      expect(unmappedInvoiceProductService.resolveFromCreatedProduct).not.toHaveBeenCalled();
    });

    it.each([
      ["outro tipo (ERROR_INVOICE)", { type: "ERROR_INVOICE", reason: "SKU ausente na nota" }, /só é feito a partir/i],
      ["ERROR_CATALOG com outro motivo", { reason: "Outro motivo" }, /só é feito a partir/i],
      ["external_id vazio", { external_id: null }, /não tem o código do Tecinco/i],
    ])("%s: 400 PRODUCT_NOT_MAPPED_IN_INTEGRATION com mensagem do motivo, nada é criado", async (_label, overrides, message) => {
      (unmappedInvoiceProductService.findById as jest.Mock).mockResolvedValue({ ...catalogUnmapped, ...overrides });

      const error = await service
        .createFromUnmapped({ productId: "product-1", unmappedInvoiceProductId: "unmapped-1" })
        .catch((e) => e);

      expect(error).toBeInstanceOf(SupplierMappingError);
      expect(error.code).toBe(SupplierMappingErrorCode.PRODUCT_NOT_MAPPED_IN_INTEGRATION);
      expect(error.message).toMatch(message);
      expect(SupplierMapping.create).not.toHaveBeenCalled();
      expect(integrationMappingService.createOrUpdateIntegrationMapping).not.toHaveBeenCalled();
      expect(unmappedInvoiceProductService.delete).not.toHaveBeenCalled();
      expect(unmappedInvoiceProductService.resolveFromCreatedProduct).not.toHaveBeenCalled();
    });
  });
});

describe("SupplierMappingService.updateForProduct — desativar EAN físico confirmado", () => {
  let service: SupplierMappingService;
  const recordUpdate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupplierMappingService();
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "sm-1",
      supplier_product_code: "7891234567895",
      is_physical_override: true,
    });
    recordUpdate.mockImplementation(async (data: any) => ({ id: "sm-1", ...data }));
    (SupplierMapping.findByPk as jest.Mock).mockResolvedValue({ update: recordUpdate });
  });

  it("admin desativa: grava is_physical_override false e audita no DE x PARA e no produto", async () => {
    const result = await service.updateForProduct(
      "sm-1", "product-1", "integration-1", { is_physical_override: false }, true, "user-1",
    );

    expect(recordUpdate).toHaveBeenCalledWith({ is_physical_override: false }, { transaction: mockTransaction });
    expect(result).toMatchObject({ is_physical_override: false });
    const entries = (AuditLog.bulkCreate as jest.Mock).mock.calls[0][0];
    expect(entries.map((e: any) => [e.entity, e.internal_id, e.user_id])).toEqual([
      ["SUPPLIER_MAPPING", "sm-1", "user-1"],
      ["PRODUCT", "product-1", "user-1"],
    ]);
    expect(entries[0].changes.after).toEqual({ supplier_product_code: "7891234567895", is_physical_override: false });
  });

  it("quem não é admin/developer não desativa: erro, nada gravado", async () => {
    await expect(
      service.updateForProduct("sm-1", "product-1", "integration-1", { is_physical_override: false }, false),
    ).rejects.toThrow("Somente administradores");
    expect(recordUpdate).not.toHaveBeenCalled();
    expect(AuditLog.bulkCreate).not.toHaveBeenCalled();
  });

  it("is_physical_override true no update: erro (confirmar só pela rota própria)", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "sm-1",
      supplier_product_code: "7891234567895",
      is_physical_override: false,
    });

    await expect(
      service.updateForProduct("sm-1", "product-1", "integration-1", { is_physical_override: true }, true),
    ).rejects.toThrow("Confirmar EAN físico");
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  it("false num DE x PARA comum: não muda a flag nem audita", async () => {
    (SupplierMapping.findOne as jest.Mock).mockResolvedValue({
      id: "sm-1",
      supplier_product_code: "7891234567895",
      is_physical_override: false,
    });

    await service.updateForProduct(
      "sm-1", "product-1", "integration-1", { supplier_cnpj: "123", is_physical_override: false }, false,
    );

    expect(recordUpdate).toHaveBeenCalledWith({ supplier_cnpj: "123" }, { transaction: mockTransaction });
    expect(AuditLog.bulkCreate).not.toHaveBeenCalled();
  });
});

describe("SupplierMappingService.buildErrorResponse — EAN em uso decide Confirmar EAN físico vs. foto", () => {
  let service: SupplierMappingService;
  const ownedError = () =>
    new SupplierMappingError(SupplierMappingErrorCode.EAN_OWNED_BY_ANOTHER_PRODUCT, "O EAN 789 já está em uso por: \"A\".", []);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SupplierMappingService();
  });

  it("admin sem a permissão no papel: pode confirmar", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue({ type: "admin", role: { permissions: [] } });

    const body = await service.buildErrorResponse(ownedError(), "token");

    expect(body.can_confirm_physical_owner).toBe(true);
    expect(body.error).toContain("Confirmar EAN físico");
  });

  it("papel com a permissão: pode confirmar", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue({
      type: "operator",
      role: { permissions: [{ entity: "physical_ean_owner", permissions: ["write"] }] },
    });

    expect((await service.buildErrorResponse(ownedError(), "token")).can_confirm_physical_owner).toBe(true);
  });

  it("sem permissão: mensagem de foto", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue({ type: "operator", role: { permissions: [] } });

    const body = await service.buildErrorResponse(ownedError(), "token");

    expect(body.can_confirm_physical_owner).toBe(false);
    expect(body.error).toContain("Tire uma foto para registrar o produto");
  });

  it("EAN físico de outro produto: nunca oferece confirmar e não consulta o usuário", async () => {
    const error = new SupplierMappingError(SupplierMappingErrorCode.EAN_HAS_PHYSICAL_OVERRIDE, "msg");

    const body = await service.buildErrorResponse(error, "token");

    expect(body).toMatchObject({ error: "msg", code: SupplierMappingErrorCode.EAN_HAS_PHYSICAL_OVERRIDE, can_confirm_physical_owner: false });
    expect(userService.getMe).not.toHaveBeenCalled();
  });
});
