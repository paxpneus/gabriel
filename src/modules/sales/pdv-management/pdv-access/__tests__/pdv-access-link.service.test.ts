jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    getCd21UnitBusiness: jest.fn(),
    getComercialUnitBusinessOnly: jest.fn(),
  },
}));

jest.mock("../../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn() },
}));

import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import redisService from "../../../../../shared/utils/base-models/base-redis";
import { PdvAccessLinkService } from "../pdv-access-link.service";

const cd21 = { id: "cd21-id", number: "21", name: "CD21" };
const storeA = { id: "store-a", number: "15", name: "Loja A" };

describe("PdvAccessLinkService", () => {
  let service: PdvAccessLinkService;

  beforeAll(() => {
    process.env.PDV_ACCESS_TOKEN_SECRET = "test-secret";
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (redisService.get as jest.Mock).mockResolvedValue(null);
    (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue(
      cd21,
    );
    service = new PdvAccessLinkService();
  });

  it("no cache miss, consulta o banco e grava o resultado no cache (uma loja)", async () => {
    (unitBusinessService.findById as jest.Mock).mockResolvedValue(storeA);

    const result = await service.getAccessLinks(storeA.id);

    expect(unitBusinessService.findById).toHaveBeenCalledWith(storeA.id);
    expect(redisService.set).toHaveBeenCalledWith(
      `pdv-access:links:store:${storeA.id}`,
      result,
      { mode: "EX", duration: 3600 },
    );
  });

  it("no cache hit, devolve do cache sem consultar o banco", async () => {
    const cached = { unitBusinessId: storeA.id };
    (redisService.get as jest.Mock).mockResolvedValue(cached);

    const result = await service.getAccessLinks(storeA.id);

    expect(result).toBe(cached);
    expect(unitBusinessService.findById).not.toHaveBeenCalled();
    expect(unitBusinessService.getCd21UnitBusiness).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it("sem unitBusinessId, usa a chave de cache 'all' e lista todas as lojas comerciais", async () => {
    (
      unitBusinessService.getComercialUnitBusinessOnly as jest.Mock
    ).mockResolvedValue([storeA]);

    const result = await service.getAccessLinks();

    expect(Array.isArray(result)).toBe(true);
    expect(redisService.get).toHaveBeenCalledWith("pdv-access:links:all");
    expect(redisService.set).toHaveBeenCalledWith(
      "pdv-access:links:all",
      result,
      { mode: "EX", duration: 3600 },
    );
  });

  it("cd21Url usa o número da unidade CD21, não o da loja consultada", async () => {
    (unitBusinessService.findById as jest.Mock).mockResolvedValue(storeA);

    const result = (await service.getAccessLinks(storeA.id)) as any;

    expect(result.cd21Url).toContain("number=21");
    expect(result.storeRequestUrl).toContain("number=15");
  });
});
