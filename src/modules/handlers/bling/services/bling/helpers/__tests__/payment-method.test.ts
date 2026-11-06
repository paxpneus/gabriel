jest.mock("../../../../../../integrations/integration-mapping/integration-mapping.service", () => ({
  __esModule: true,
  default: {
    findMappingsByExternalIds: jest.fn(),
    bulkCreateNonPrimary: jest.fn(),
    updateErpData: jest.fn(),
  },
}));
jest.mock("../../../../../../integrations/unmapped-entities/unmapped-entity.service", () => ({
  __esModule: true,
  default: { registerMany: jest.fn(), removeMany: jest.fn() },
}));
jest.mock("../../../../../../sales/orders/payment_method/payment_method.service", () => ({
  __esModule: true,
  default: { findCatalogWithIntegrationTypes: jest.fn() },
}));

import integrationMappingService from "../../../../../../integrations/integration-mapping/integration-mapping.service";
import unmappedEntityService from "../../../../../../integrations/unmapped-entities/unmapped-entity.service";
import paymentMethodService from "../../../../../../sales/orders/payment_method/payment_method.service";
import { resolveBlingPaymentMethods } from "../payment-method";

const mappings = integrationMappingService as jest.Mocked<typeof integrationMappingService>;
const unmapped = unmappedEntityService as jest.Mocked<typeof unmappedEntityService>;
const paymentMethods = paymentMethodService as jest.Mocked<typeof paymentMethodService>;

const catalog = [
  { id: "pm-cash", id_system: "1", raw_payload: { blingTypes: [1] } },
  { id: "pm-credit", id_system: "3", raw_payload: { blingTypes: [3] } },
  { id: "pm-pix", id_system: "17", raw_payload: { blingTypes: [17, 20] } },
  { id: "pm-no-payload", id_system: "50", raw_payload: null },
  { id: "pm-other", id_system: "99", raw_payload: { blingTypes: [99] } },
];

const fullErp = {
  name: "Rede - Crédito Master 2x",
  type: 3,
  type_name: "Cartão de Crédito",
  installments: 2,
  card_brand: 2,
  card_brand_name: "Mastercard",
  updated_at: "x",
};

// bulkCreateNonPrimary devolve o que ficou no banco: por padrão, exatamente o que foi pedido.
function bulkCreatesAsRequested() {
  mappings.bulkCreateNonPrimary.mockImplementation(async (_entity, _integration, rows) => {
    return new Map(
      rows.map((row) => [row.external_id, { id: `map-${row.external_id}`, internal_id: row.internal_id, erp_data: row.erp_data ?? null }]),
    ) as any;
  });
}

describe("resolveBlingPaymentMethods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    paymentMethods.findCatalogWithIntegrationTypes.mockResolvedValue(catalog as any);
    mappings.findMappingsByExternalIds.mockResolvedValue(new Map());
    bulkCreatesAsRequested();
  });

  it("lista vazia: não consulta nada além do lookup e devolve mapa vazio", async () => {
    mappings.findMappingsByExternalIds.mockResolvedValue(new Map());
    const result = await resolveBlingPaymentMethods([], "int-bling");
    expect(result.size).toBe(0);
    expect(paymentMethods.findCatalogWithIntegrationTypes).not.toHaveBeenCalled();
    expect(mappings.bulkCreateNonPrimary).not.toHaveBeenCalled();
  });

  it("mapping existente com snapshot igual: resolve sem ler catálogo e sem regravar erp_data", async () => {
    mappings.findMappingsByExternalIds.mockResolvedValue(
      new Map([["9521718", { id: "map-1", internal_id: "pm-credit", erp_data: fullErp }]]) as any,
    );

    const result = await resolveBlingPaymentMethods(
      [{ id: 9521718, type: 3, description: "Rede - Crédito Master 2x", installments: 2, cardBrand: 2 }],
      "int-bling",
    );

    expect(result.get("9521718")).toBe("pm-credit");
    expect(paymentMethods.findCatalogWithIntegrationTypes).not.toHaveBeenCalled();
    expect(mappings.bulkCreateNonPrimary).not.toHaveBeenCalled();
    expect(mappings.updateErpData).not.toHaveBeenCalled();
  });

  it("mapping sem erp_data, com nome mudado ou sem os nomes (snapshot antigo): regrava; populate sem parcelas mantém as anteriores", async () => {
    mappings.findMappingsByExternalIds.mockResolvedValue(
      new Map([
        ["1", { id: "map-1", internal_id: "pm-credit", erp_data: null }],
        ["2", { id: "map-2", internal_id: "pm-credit", erp_data: { ...fullErp, name: "Nome antigo", installments: 3 } }],
        ["3", { id: "map-3", internal_id: "pm-credit", erp_data: { name: "Crédito Visa 1x", type: 3, installments: 1, card_brand: 1, updated_at: "x" } }],
      ]) as any,
    );

    await resolveBlingPaymentMethods(
      [
        { id: 1, type: 3, description: "Rede - Crédito Master 2x", installments: 2, cardBrand: 2 },
        { id: 2, type: 3, description: "Rede - Crédito Master 3x" },
        { id: 3, type: 3, description: "Crédito Visa 1x" },
      ],
      "int-bling",
    );

    expect(mappings.updateErpData).toHaveBeenCalledTimes(3);
    expect(mappings.updateErpData).toHaveBeenCalledWith(
      "map-1",
      expect.objectContaining({ name: "Rede - Crédito Master 2x", type: 3, type_name: "Cartão de Crédito", installments: 2, card_brand: 2, card_brand_name: "Mastercard" }),
    );
    expect(mappings.updateErpData).toHaveBeenCalledWith(
      "map-2",
      expect.objectContaining({ name: "Rede - Crédito Master 3x", installments: 3, card_brand: 2, card_brand_name: "Mastercard" }),
    );
    expect(mappings.updateErpData).toHaveBeenCalledWith(
      "map-3",
      expect.objectContaining({ type_name: "Cartão de Crédito", card_brand_name: "Visa", installments: 1 }),
    );
  });

  it("pedido com bandeira null (forma sem cartão) sobrescreve a bandeira anterior; undefined mantém", async () => {
    mappings.findMappingsByExternalIds.mockResolvedValue(
      new Map([["5", { id: "map-5", internal_id: "pm-credit", erp_data: fullErp }]]) as any,
    );
    await resolveBlingPaymentMethods(
      [{ id: 5, type: 3, description: "Rede - Crédito Master 2x", installments: 2, cardBrand: null }],
      "int-bling",
    );
    expect(mappings.updateErpData).toHaveBeenCalledWith(
      "map-5",
      expect.objectContaining({ card_brand: null, card_brand_name: null }),
    );
  });

  it("sem mapping: auto-mapeia pelo tipo (inclusive tipo secundário do grupo, Pix estático 20) em lote, não principal, com erp_data", async () => {
    const result = await resolveBlingPaymentMethods(
      [
        { id: 9521738, type: 3, description: "Rede - Crédito Master 3x", installments: 3, cardBrand: 2 },
        { id: 555, type: 20, description: "Pix estático" },
        { id: 5352299, type: 1, description: "Dinheiro" },
      ],
      "int-bling",
    );

    expect(result.get("9521738")).toBe("pm-credit");
    expect(result.get("555")).toBe("pm-pix");
    expect(result.get("5352299")).toBe("pm-cash");
    expect(mappings.bulkCreateNonPrimary).toHaveBeenCalledTimes(1);
    expect(mappings.bulkCreateNonPrimary).toHaveBeenCalledWith("PAYMENT_METHOD", "int-bling", [
      { external_id: "9521738", internal_id: "pm-credit", erp_data: expect.objectContaining({ installments: 3, card_brand_name: "Mastercard" }) },
      { external_id: "555", internal_id: "pm-pix", erp_data: expect.objectContaining({ type_name: "Pix Estático", installments: null }) },
      { external_id: "5352299", internal_id: "pm-cash", erp_data: expect.objectContaining({ type_name: "Dinheiro" }) },
    ]);
    expect(unmapped.registerMany).not.toHaveBeenCalled();
    // pendência antiga desses códigos (se houver) sai da lista
    expect(unmapped.removeMany).toHaveBeenCalledWith("PAYMENT_METHOD", "int-bling", ["9521738", "555", "5352299"]);
  });

  it("forma repetida no lote (várias parcelas da mesma forma) é resolvida uma vez só", async () => {
    await resolveBlingPaymentMethods(
      [
        { id: 7, type: 3, description: "Crédito Visa 3x" },
        { id: "7", type: 3, description: "Crédito Visa 3x" },
      ],
      "int-bling",
    );
    expect(mappings.findMappingsByExternalIds).toHaveBeenCalledWith("PAYMENT_METHOD", "int-bling", ["7"]);
    expect(mappings.bulkCreateNonPrimary.mock.calls[0][2]).toHaveLength(1);
  });

  it("tipo sem método no catálogo (Devolução tipo 5, tipo null, catálogo sem raw_payload) vira pendência e usa Outros", async () => {
    const result = await resolveBlingPaymentMethods(
      [
        { id: 8104554, type: 5, description: "Devolução de mercadorias" },
        { id: 10246822, type: null, description: null },
      ],
      "int-bling",
    );

    expect(result.get("8104554")).toBe("pm-other");
    expect(result.get("10246822")).toBe("pm-other");
    // nada pra auto-mapear (o service real sai sem query com lista vazia)
    expect(mappings.bulkCreateNonPrimary.mock.calls.flatMap((call) => call[2])).toEqual([]);
    expect(unmapped.registerMany).toHaveBeenCalledWith("PAYMENT_METHOD", "int-bling", [
      { externalId: "8104554", description: "Devolução de mercadorias" },
      { externalId: "10246822", description: null },
    ]);
  });

  it("lote misto: mapeado + auto-mapeado + pendente na mesma chamada", async () => {
    mappings.findMappingsByExternalIds.mockResolvedValue(
      new Map([["1", { id: "map-1", internal_id: "pm-credit", erp_data: { ...fullErp, name: "A" } }]]) as any,
    );

    const result = await resolveBlingPaymentMethods(
      [
        { id: 1, type: 3, description: "A" },
        { id: 2, type: 17, description: "Pix" },
        { id: 3, type: 5, description: "Devolução" },
      ],
      "int-bling",
    );

    expect([...result.entries()]).toEqual([
      ["1", "pm-credit"],
      ["2", "pm-pix"],
      ["3", "pm-other"],
    ]);
  });

  it("código auto-mapeado por outra fila no meio do caminho: vale o mapping que está no banco", async () => {
    mappings.bulkCreateNonPrimary.mockResolvedValue(
      new Map([["9521738", { id: "map-x", internal_id: "pm-manual", erp_data: null }]]) as any,
    );

    const result = await resolveBlingPaymentMethods(
      [{ id: 9521738, type: 3, description: "Rede - Crédito Master 3x" }],
      "int-bling",
    );

    expect(result.get("9521738")).toBe("pm-manual");
  });

  it("sem 'Outros' no catálogo (seed não rodou) e forma sem tipo coberto: erro claro, sem registrar pendência", async () => {
    paymentMethods.findCatalogWithIntegrationTypes.mockResolvedValue(
      catalog.filter((item) => item.id_system !== "99") as any,
    );

    await expect(
      resolveBlingPaymentMethods([{ id: 8104554, type: 5, description: "Devolução" }], "int-bling"),
    ).rejects.toThrow(/Outros/);
    expect(unmapped.registerMany).not.toHaveBeenCalled();
  });
});
