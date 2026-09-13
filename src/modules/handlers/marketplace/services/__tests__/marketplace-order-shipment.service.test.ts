jest.mock("../../helpers/mappers/map-marketplace-api", () => ({
  __esModule: true,
  resolveMarketplaceHandler: jest.fn(),
}));

import { resolveMarketplaceHandler } from "../../helpers/mappers/map-marketplace-api";
import {
  getMarketplaceCollectionAndLabelStatus,
  getMarketplaceCollectionAndLabelStatusWithRetry,
} from "../marketplace-order-shipment.service";
import { MarketPlaceLabelStatus } from "../../../../sales/orders/order/orders.types";

function makeHandler(overrides: Partial<any> = {}) {
  return {
    api: {},
    fetchOrder: jest.fn(),
    mapOrderResponse: jest.fn(),
    fetchShipment: jest.fn(),
    mapShipmentResponse: jest.fn(),
    resolveOrdersFromShipment: jest.fn(),
    ...overrides,
  };
}

describe("getMarketplaceCollectionAndLabelStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("order sem shipmentId: devolve UNKNOWN sem buscar shipment", async () => {
    const handler = makeHandler({
      fetchOrder: jest.fn().mockResolvedValue({ id: 1 }),
      mapOrderResponse: jest.fn().mockReturnValue({ shipmentId: null }),
    });
    (resolveMarketplaceHandler as jest.Mock).mockReturnValue(handler);

    const result = await getMarketplaceCollectionAndLabelStatus("MercadoLivre", "123");

    expect(result).toEqual({ collectionDate: null, labelStatus: MarketPlaceLabelStatus.UNKNOWN });
    expect(handler.fetchShipment).not.toHaveBeenCalled();
  });

  it("order com shipmentId: busca o shipment e devolve o mapeamento do handler", async () => {
    const mapped = { collectionDate: new Date("2026-08-20"), labelStatus: MarketPlaceLabelStatus.READY_TO_PRINT };
    const handler = makeHandler({
      fetchOrder: jest.fn().mockResolvedValue({ id: 1, shipping: { id: 999 } }),
      mapOrderResponse: jest.fn().mockReturnValue({ shipmentId: "999" }),
      fetchShipment: jest.fn().mockResolvedValue({ id: 999 }),
      mapShipmentResponse: jest.fn().mockReturnValue(mapped),
    });
    (resolveMarketplaceHandler as jest.Mock).mockReturnValue(handler);

    const result = await getMarketplaceCollectionAndLabelStatus("MercadoLivre", "123");

    expect(handler.fetchShipment).toHaveBeenCalledWith("999");
    expect(result).toEqual(mapped);
  });
});

describe("getMarketplaceCollectionAndLabelStatusWithRetry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sucesso na 1ª tentativa: devolve o resultado sem retry", async () => {
    const mapped = { collectionDate: null, labelStatus: MarketPlaceLabelStatus.UNKNOWN };
    const handler = makeHandler({
      fetchOrder: jest.fn().mockResolvedValue({ id: 1 }),
      mapOrderResponse: jest.fn().mockReturnValue({ shipmentId: null }),
    });
    (resolveMarketplaceHandler as jest.Mock).mockReturnValue(handler);

    const result = await getMarketplaceCollectionAndLabelStatusWithRetry("MercadoLivre", "123");

    expect(result).toEqual(mapped);
    expect(handler.fetchOrder).toHaveBeenCalledTimes(1);
  });

  it("falha na 1ª tentativa, sucesso na 2ª: devolve o resultado", async () => {
    const mapped = { collectionDate: new Date("2026-08-20"), labelStatus: MarketPlaceLabelStatus.READY_TO_PRINT };
    const handler = makeHandler({
      fetchOrder: jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ id: 1, shipping: { id: 999 } }),
      mapOrderResponse: jest.fn().mockReturnValue({ shipmentId: "999" }),
      fetchShipment: jest.fn().mockResolvedValue({ id: 999 }),
      mapShipmentResponse: jest.fn().mockReturnValue(mapped),
    });
    (resolveMarketplaceHandler as jest.Mock).mockReturnValue(handler);

    const pending = getMarketplaceCollectionAndLabelStatusWithRetry("MercadoLivre", "123");
    await jest.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result).toEqual(mapped);
    expect(handler.fetchOrder).toHaveBeenCalledTimes(2);
  });

  it("todas as tentativas falham: devolve null, sem lançar", async () => {
    const handler = makeHandler({
      fetchOrder: jest.fn().mockRejectedValue(new Error("ML fora do ar")),
    });
    (resolveMarketplaceHandler as jest.Mock).mockReturnValue(handler);

    const pending = getMarketplaceCollectionAndLabelStatusWithRetry("MercadoLivre", "123");
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result).toBeNull();
    expect(handler.fetchOrder).toHaveBeenCalledTimes(3);
  });
});
