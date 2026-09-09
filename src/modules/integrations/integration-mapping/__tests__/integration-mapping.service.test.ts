// IntegrationMapping (*.model.ts) é auto-mocado globalmente via
// src/__tests__/setup.ts — usa o model direto (via o repository real,
// que é só um wrapper fino) pra testar a lógica de matching de verdade.

import IntegrationMapping from "../integration-mapping.model";
import { IntegrationMappingService } from "../integration-mapping.service";

describe("IntegrationMappingService.createOrUpdateIntegrationMapping", () => {
  let service: IntegrationMappingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntegrationMappingService();
  });

  it("sem mapping nenhum pra esse external_id: cria", async () => {
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(null);
    (IntegrationMapping.create as jest.Mock).mockResolvedValue({
      id: "new-mapping-id",
    });

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entity_type: "PRODUCT",
          integrations_id: "tecinco-integration",
          external_id: "13216",
        },
      }),
    );
    expect(IntegrationMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "PRODUCT",
        internal_id: "product-1",
        integrations_id: "tecinco-integration",
        external_id: "13216",
      }),
      expect.anything(),
    );
    expect(result).toEqual({ id: "new-mapping-id" });
  });

  it("já existe mapping pra esse external_id, mesmo internal_id: idempotente, não recria", async () => {
    const existing = { id: "existing-id", internal_id: "product-1", external_id: "13216" };
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(existing);

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("já existe mapping pra esse external_id apontando pra OUTRO internal_id: não reaponta, devolve o existente (proteção contra reatribuição errada)", async () => {
    const existing = { id: "existing-id", internal_id: "other-product", external_id: "13216" };
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(existing);
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1",
      integrations_id: "tecinco-integration",
      external_id: "13216",
    });

    expect(IntegrationMapping.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("13216"));
  });

  it("o mesmo internal_id JÁ TEM mapping pra outro external_id: cria um novo mesmo assim (Tecinco reaproveita/duplica epctb_codigo pro mesmo produto físico — não é mais bloqueado por internal_id)", async () => {
    // findOne é escopado por external_id — o mapping existente é pra um
    // external_id diferente do que está sendo criado agora, então não bate
    // e a query retorna null pra esse external_id específico.
    (IntegrationMapping.findOne as jest.Mock).mockResolvedValue(null);
    (IntegrationMapping.create as jest.Mock).mockResolvedValue({
      id: "second-mapping-id",
    });

    const result = await service.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: "product-1", // já tinha mapping pro external_id "20517"
      integrations_id: "tecinco-integration",
      external_id: "13216", // novo código, mesmo produto
    });

    expect(IntegrationMapping.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entity_type: "PRODUCT",
          integrations_id: "tecinco-integration",
          external_id: "13216",
        },
      }),
    );
    expect(IntegrationMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({ internal_id: "product-1", external_id: "13216" }),
      expect.anything(),
    );
    expect(result).toEqual({ id: "second-mapping-id" });
  });
});
