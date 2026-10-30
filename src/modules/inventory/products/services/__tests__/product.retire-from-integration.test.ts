// Mocks com factory — o product.service puxa módulos que abrem Redis/BullMQ no import.
jest.mock("../../repository/product.repository", () => ({
  __esModule: true,
  ProductRepository: class {},
  default: { findOne: jest.fn(), update: jest.fn() },
}));
jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock("../../../../integrations/integration-mapping/integration-mapping.service", () => ({
  __esModule: true,
  default: {
    findProductMappingByExternalId: jest.fn(),
    retirePrimaryCodeIfDuplicated: jest.fn(),
    findEntityByMapping: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    bulkDelete: jest.fn(),
  },
}));
jest.mock("../../../supplier-mapping/supplier-mapping.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), bulkDelete: jest.fn() },
}));
jest.mock("../../../product-config/product_config.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), bulkDelete: jest.fn() },
}));
jest.mock("../../../../global/audit-logs/audit-log.service", () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock("../../../brands/brands.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../warehouse/expedition/batch/batch.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../warehouse/expedition/batch-items/batch-items.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../../handlers/tecinco/queues/helpers/product.helpers", () => ({ __esModule: true }));
jest.mock("../../repository/product-with-movements", () => ({ __esModule: true, default: {} }));
jest.mock("../../../kit-components/kit-component.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../rims/rim.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../../tire-measures/tire-measure.service", () => ({ __esModule: true, default: {} }));

import { Op } from "sequelize";
import productService from "../product.service";
import productRepository from "../../repository/product.repository";
import Product from "../../product.model";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";
import supplierMappingService from "../../../supplier-mapping/supplier-mapping.service";
import productConfigService from "../../../product-config/product_config.service";
import auditLogService from "../../../../global/audit-logs/audit-log.service";
import { AuditAction, AuditEntity, AuditOrigin } from "../../../../global/audit-logs/audit-log.types";

const INTEGRATION = { id: "int-bling", name: "Bling" };
const PRODUCT_ID = "product-1";
const mockTransaction = { LOCK: { UPDATE: "UPDATE" } } as any;

const retire = () => productService.retireFromIntegration({ integration: INTEGRATION, externalId: "123", logPrefix: "[test]" });

describe("ProductService.retireFromIntegration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Product as any).sequelize = { transaction: jest.fn((cb: any) => cb(mockTransaction)) };
    (integrationMappingService.findProductMappingByExternalId as jest.Mock).mockResolvedValue(null);
    (integrationMappingService.findEntityByMapping as jest.Mock).mockResolvedValue({ id: PRODUCT_ID, name: "Pneu" });
    (unitBusinessService.findAll as jest.Mock).mockResolvedValue([{ id: "ub-bling" }]);
    (integrationMappingService.findAll as jest.Mock).mockResolvedValue([{ id: "map-1", external_id: "123", is_primary: true }]);
    (supplierMappingService.findAll as jest.Mock).mockResolvedValue([]);
    (productConfigService.findAll as jest.Mock).mockResolvedValue([{ id: "config-1", sku: "SKU-1", gtin: "789" }]);
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue(null);
    // bulkDelete por `id IN` devolve quantos ids recebeu (a contagem é conferida com as linhas travadas).
    const countIds = ({ where }: any) => Promise.resolve(where?.id?.[Op.in]?.length ?? 0);
    (integrationMappingService.bulkDelete as jest.Mock).mockImplementation(countIds);
    (supplierMappingService.bulkDelete as jest.Mock).mockImplementation(countIds);
    (productConfigService.bulkDelete as jest.Mock).mockImplementation(countIds);
    // 1ª leitura = before travado; 2ª = after relido depois do update.
    (productRepository.findOne as jest.Mock)
      .mockResolvedValueOnce({ id: PRODUCT_ID, is_active: true })
      .mockResolvedValueOnce({ is_active: false });
  });

  it("sem mapping em outra integração: trava e apaga só o que é da integração, inativa e grava audit SYSTEM", async () => {
    await retire();

    expect(integrationMappingService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity_type: "PRODUCT", internal_id: PRODUCT_ID, integrations_id: INTEGRATION.id },
        lock: "UPDATE",
      }),
    );
    expect(supplierMappingService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { product_id: PRODUCT_ID, integrations_id: INTEGRATION.id }, lock: "UPDATE" }),
    );
    expect(productConfigService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { product_id: PRODUCT_ID, unit_business_id: { [Op.in]: ["ub-bling"] } }, lock: "UPDATE" }),
    );
    expect(integrationMappingService.bulkDelete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { [Op.in]: ["map-1"] } } }));
    expect(productConfigService.bulkDelete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { [Op.in]: ["config-1"] } } }));
    expect(productRepository.update).toHaveBeenCalledWith(PRODUCT_ID, { is_active: false }, { transaction: mockTransaction });
    expect(auditLogService.record).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: null,
          origin: AuditOrigin.SYSTEM,
          entity: AuditEntity.PRODUCT,
          internalId: PRODUCT_ID,
          changes: expect.objectContaining({
            before: { is_active: true },
            after: { is_active: false },
            affected: [
              expect.objectContaining({ entity: AuditEntity.INTEGRATION_MAPPING, internal_id: "map-1", action: AuditAction.DELETE }),
              expect.objectContaining({ entity: AuditEntity.PRODUCT_CONFIG, internal_id: "config-1", action: AuditAction.DELETE }),
            ],
          }),
        }),
      ],
      mockTransaction,
    );
  });

  it("DE x PARA com EAN físico confirmado: avisa no resumo e grava is_physical_override no affected", async () => {
    (supplierMappingService.findAll as jest.Mock).mockResolvedValue([
      { id: "sm-1", supplier_product_code: "7893091034398", is_physical_override: true },
    ]);

    await retire();

    const [[entries]] = (auditLogService.record as jest.Mock).mock.calls;
    expect(entries[0].changes.summary).toContain("Confirmação de EAN físico removida: 7893091034398");
    expect(entries[0].changes.affected).toContainEqual(
      expect.objectContaining({
        entity: AuditEntity.SUPPLIER_MAPPING,
        internal_id: "sm-1",
        before: { supplier_product_code: "7893091034398", is_physical_override: true },
      }),
    );
  });

  it("com mapping em outra integração: desassocia mas segue ativo (audit com before/after null)", async () => {
    (integrationMappingService.findOne as jest.Mock).mockResolvedValue({ id: "map-tecinco" });

    await retire();

    expect(integrationMappingService.bulkDelete).toHaveBeenCalled();
    expect(productRepository.update).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      [expect.objectContaining({ origin: AuditOrigin.SYSTEM, changes: expect.objectContaining({ before: null, after: null }) })],
      mockTransaction,
    );
  });

  it("delete apagou quantidade diferente das linhas travadas: lança erro (rollback) sem inativar nem gravar audit", async () => {
    (integrationMappingService.bulkDelete as jest.Mock).mockResolvedValue(0);

    await expect(retire()).rejects.toThrow("deleted rows differ from locked rows");

    expect(productRepository.update).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it("mapping não principal: ignora, não desassocia nada", async () => {
    (integrationMappingService.findProductMappingByExternalId as jest.Mock).mockResolvedValue({ id: "map-2", internal_id: PRODUCT_ID, is_primary: false });

    await retire();

    expect(integrationMappingService.findEntityByMapping).not.toHaveBeenCalled();
    expect(integrationMappingService.bulkDelete).not.toHaveBeenCalled();
  });

  it("principal com outro código do produto na integração: só aposenta esse código, produto não é desassociado", async () => {
    (integrationMappingService.findProductMappingByExternalId as jest.Mock).mockResolvedValue({ id: "map-1", internal_id: PRODUCT_ID, is_primary: true });
    (integrationMappingService.retirePrimaryCodeIfDuplicated as jest.Mock).mockResolvedValue(true);

    await retire();

    expect(integrationMappingService.retirePrimaryCodeIfDuplicated).toHaveBeenCalledWith("map-1", PRODUCT_ID, INTEGRATION);
    expect(integrationMappingService.bulkDelete).not.toHaveBeenCalled();
  });

  it("sem produto local mapeado: ignora, não desassocia nada", async () => {
    (integrationMappingService.findEntityByMapping as jest.Mock).mockResolvedValue(null);

    await retire();

    expect(integrationMappingService.bulkDelete).not.toHaveBeenCalled();
    expect(productRepository.update).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });
});
