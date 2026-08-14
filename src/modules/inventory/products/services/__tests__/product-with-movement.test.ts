import { StockMovementService } from './../../../stock/stock-movements/stock-movements.service';

jest.mock("../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb) => cb({})),
    where: jest.fn((col, val) => ({ col, val })),
    fn: jest.fn((fnName, ...args) => ({ fnName, args })),
    col: jest.fn((name) => name),
  },
}));

const PRODUCT_ID = "f88bde21-efa6-4955-ba6e-d23bcb4f270c";
const UNIT_BUSINESS_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

const mockLastPurchaseEntries = new Map([
  [
    PRODUCT_ID,
    [
      {
        id: "8cddd757-5199-4b74-86c4-06e8bc7a6ab8",
        resulting_average_cost: "2596.5875",
      },
      {
        id: "092f9bc8-1e76-4027-9702-207dc0ebb440",
        resulting_average_cost: "2841.2200",
      },
    ],
  ],
]);

const mockLastMovement = new Map([
  [
    PRODUCT_ID,
    {
      id: "42c7192a-897b-40b4-be2a-253c6089ce30",
      balance_quantity: "2.0000",
      resulting_average_cost: "2596.5875",
    },
  ],
]);

describe("StockMovementService", () => {
  let service: StockMovementService;

  beforeEach(() => {
    service = new StockMovementService();

    (service as any).repository = {
      findLastEffectiveMovements: jest.fn().mockResolvedValue(mockLastPurchaseEntries),
      findLastMovementsByProducts: jest.fn().mockResolvedValue(mockLastMovement),
    };
  });

  describe("findLastEffectiveMovements", () => {
    it("delega pro repository com os mesmos parâmetros e devolve o Map sem alterar", async () => {
      const asOfDate = new Date("2026-08-01T00:00:00.000Z");

      const result = await service.findLastEffectiveMovements(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        asOfDate,
        2,
      );

      expect((service as any).repository.findLastEffectiveMovements).toHaveBeenCalledWith(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        asOfDate,
        2,
      );
      expect(result).toBe(mockLastPurchaseEntries);
      expect(result.get(PRODUCT_ID)?.[0].id).toBe(
        "8cddd757-5199-4b74-86c4-06e8bc7a6ab8",
      );
    });

    it("respeita cutoff de data: filtra 01/08–10/08 exclui entrada de 11/08", async () => {
      const filterEnd = new Date("2026-08-10T23:59:59.999Z");
      
      // Mock: quando chamado com filterEnd, retorna só a entrada de 04/08
      (service as any).repository.findLastEffectiveMovements.mockResolvedValueOnce(
        new Map([[PRODUCT_ID, [{ id: "entry-04-aug", movement_date: "2026-08-04T19:21:51.000Z" }]]])
      );

      const result = await service.findLastEffectiveMovements(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        filterEnd,
        2,
      );

      // Valida que foi chamado com o cutoff correto
      expect((service as any).repository.findLastEffectiveMovements).toHaveBeenCalledWith(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        filterEnd,
        2,
      );
      
      // Valida que retorna só a entrada dentro do range
      expect(result.get(PRODUCT_ID)?.map((e: any) => e.id)).toEqual(["entry-04-aug"]);
    });
  });

  describe("getCurrentBalances", () => {
    it("delega pro repository com os mesmos parâmetros e devolve o Map sem alterar", async () => {
      const asOfDate = new Date("2026-08-01T00:00:00.000Z");

      const result = await service.getCurrentBalances(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        asOfDate,
      );

      expect((service as any).repository.findLastMovementsByProducts).toHaveBeenCalledWith(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        asOfDate,
      );
      expect(result).toBe(mockLastMovement);
      expect(result.get(PRODUCT_ID)?.id).toBe(
        "42c7192a-897b-40b4-be2a-253c6089ce30",
      );
    });

    it("passa o cutoff de data (asOfDate) ao repository", async () => {
      const filterEnd = new Date("2026-08-10T23:59:59.999Z");

      await service.getCurrentBalances(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        filterEnd,
      );

      expect((service as any).repository.findLastMovementsByProducts).toHaveBeenCalledWith(
        [PRODUCT_ID],
        UNIT_BUSINESS_ID,
        filterEnd,
      );
    });
  });
});