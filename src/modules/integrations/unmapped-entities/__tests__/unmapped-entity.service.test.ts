jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb({ id: "tx" })) },
}));
jest.mock("../../integration-mapping/integration-mapping.service", () => ({
  __esModule: true,
  default: { createForExistingEntity: jest.fn() },
}));
jest.mock("../../../global/audit-logs/audit-log.service", () => ({
  __esModule: true,
  default: { record: jest.fn() },
}));
jest.mock("../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { assertIntegrationAccess: jest.fn() },
}));

// UnmappedEntity (*.model.ts) é auto-mocado globalmente (src/__tests__/setup.ts); repository real por cima.
import UnmappedEntity from "../unmapped-entity.model";
import { UnmappedEntityService } from "../unmapped-entity.service";
import integrationMappingService from "../../integration-mapping/integration-mapping.service";
import auditLogService from "../../../global/audit-logs/audit-log.service";
import userService from "../../../company/users/users/user.service";
import { AuditAction, AuditEntity, AuditOrigin } from "../../../global/audit-logs/audit-log.types";

const pending = {
  id: "pend-1",
  entity: "PAYMENT_METHOD",
  external_id: "8104554",
  integrations_id: "int-bling",
  description: "Devolução de mercadorias",
};

describe("UnmappedEntityService", () => {
  let service: UnmappedEntityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UnmappedEntityService();
  });

  describe("registerMany", () => {
    it("lista vazia não grava", async () => {
      await service.registerMany("PAYMENT_METHOD", "int-bling", []);
      expect(UnmappedEntity.bulkCreate).not.toHaveBeenCalled();
    });

    it("grava em lote e, se já pendente, só atualiza a descrição", async () => {
      await service.registerMany("PAYMENT_METHOD", "int-bling", [
        { externalId: "8104554", description: "Devolução de mercadorias" },
        { externalId: "10246822", description: null },
      ]);
      const [rows, options] = (UnmappedEntity.bulkCreate as jest.Mock).mock.calls[0];
      expect(rows).toEqual([
        { entity: "PAYMENT_METHOD", integrations_id: "int-bling", external_id: "8104554", description: "Devolução de mercadorias" },
        { entity: "PAYMENT_METHOD", integrations_id: "int-bling", external_id: "10246822", description: null },
      ]);
      expect(options).toEqual({
        updateOnDuplicate: ["description", "updatedAt"],
        conflictAttributes: ["entity", "integrations_id", "external_id"],
      });
    });
  });

  describe("removeMany", () => {
    it("lista vazia não apaga; com códigos apaga só os da entidade/integração", async () => {
      await service.removeMany("PAYMENT_METHOD", "int-bling", []);
      expect(UnmappedEntity.destroy).not.toHaveBeenCalled();

      await service.removeMany("PAYMENT_METHOD", "int-bling", ["1", "2"]);
      const { where } = (UnmappedEntity.destroy as jest.Mock).mock.calls[0][0];
      expect(where).toMatchObject({ entity: "PAYMENT_METHOD", integrations_id: "int-bling" });
    });
  });

  describe("map", () => {
    it("pendência inexistente → null, sem criar mapping", async () => {
      (UnmappedEntity.findByPk as jest.Mock).mockResolvedValue(null);
      expect(await service.map("pend-x", "pm-cash", "user-1")).toBeNull();
      expect(integrationMappingService.createForExistingEntity).not.toHaveBeenCalled();
    });

    it("usuário sem acesso à integração → erro, sem criar mapping", async () => {
      (UnmappedEntity.findByPk as jest.Mock).mockResolvedValue(pending);
      (userService.assertIntegrationAccess as jest.Mock).mockRejectedValueOnce(new Error("Sem acesso à integração"));
      await expect(service.map("pend-1", "pm-cash", "user-1")).rejects.toThrow(/Sem acesso/);
      expect(integrationMappingService.createForExistingEntity).not.toHaveBeenCalled();
    });

    it("application (userId null) pula o escopo de integração", async () => {
      (UnmappedEntity.findByPk as jest.Mock).mockResolvedValue({ ...pending, destroy: jest.fn() });
      (integrationMappingService.createForExistingEntity as jest.Mock).mockResolvedValue({ id: "m1", external_id: "8104554" });
      await service.map("pend-1", "pm-cash", null);
      expect(userService.assertIntegrationAccess).not.toHaveBeenCalled();
    });

    it("cria o mapping com o nome da pendência, apaga a pendência e audita, na mesma transação", async () => {
      const destroy = jest.fn();
      (UnmappedEntity.findByPk as jest.Mock).mockResolvedValue({ ...pending, destroy });
      (integrationMappingService.createForExistingEntity as jest.Mock).mockResolvedValue({
        id: "m1",
        external_id: "8104554",
        internal_id: "pm-cash",
      });

      const mapping = await service.map("pend-1", "pm-cash", "user-1");

      expect(mapping).toMatchObject({ id: "m1" });
      expect(integrationMappingService.createForExistingEntity).toHaveBeenCalledWith(
        {
          entity_type: "PAYMENT_METHOD",
          integrations_id: "int-bling",
          external_id: "8104554",
          internal_id: "pm-cash",
          erp_data: { name: "Devolução de mercadorias", updated_at: expect.any(String) },
        },
        { id: "tx" },
      );
      expect(destroy).toHaveBeenCalledWith({ transaction: { id: "tx" } });
      const [entries, transaction] = (auditLogService.record as jest.Mock).mock.calls[0];
      expect(transaction).toEqual({ id: "tx" });
      expect(entries[0]).toMatchObject({
        userId: "user-1",
        origin: AuditOrigin.USER,
        entity: AuditEntity.INTEGRATION_MAPPING,
        internalId: "m1",
        action: AuditAction.CREATE,
      });
      expect(entries[0].changes.summary).toBe(
        'Forma de pagamento "Devolução de mercadorias" (código 8104554 no ERP) foi mapeada',
      );
    });

    it("código já mapeado pra outra forma → erro propagado, pendência fica", async () => {
      const destroy = jest.fn();
      (UnmappedEntity.findByPk as jest.Mock).mockResolvedValue({ ...pending, destroy });
      (integrationMappingService.createForExistingEntity as jest.Mock).mockRejectedValue(
        new Error("O código 8104554 no ERP já está mapeado para outro registro"),
      );
      await expect(service.map("pend-1", "pm-cash", "user-1")).rejects.toThrow(/já está mapeado/);
      expect(destroy).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });
});
