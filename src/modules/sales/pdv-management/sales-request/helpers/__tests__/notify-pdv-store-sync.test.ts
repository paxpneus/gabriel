jest.mock("../../../../../handlers/socket/services/socket-emitter.service", () => ({
  __esModule: true,
  default: { emitToNamespaceRoom: jest.fn() },
}));

import socketEmitterService from "../../../../../handlers/socket/services/socket-emitter.service";
import { notifyPdvStoreSync, notifyPdvStoresSync } from "../notify-pdv-store-sync";
import { PdvSalesRequestStatus } from "../../pdv-sales-request.types";
import { PDV_CD21_ROOM, pdvStoreRoom } from "../pdv-sales-request-room";

const request = (id: string, unit_business_id: string | null) => ({
  id,
  unit_business_id,
  status: PdvSalesRequestStatus.SHIPPING,
});

describe("notifyPdvStoreSync", () => {
  beforeEach(() => jest.clearAllMocks());

  it("leva o detalhe (requests/orderId) no payload da loja e do CD21", () => {
    notifyPdvStoreSync("ub1", "ORDER_STATUS_CHANGED", { orderId: "o1" });

    const payloads = (socketEmitterService.emitToNamespaceRoom as jest.Mock).mock.calls.map(
      ([, room, , payload]) => [room, payload],
    );
    expect(payloads).toEqual([
      [pdvStoreRoom("ub1"), { unitBusinessId: "ub1", event: "ORDER_STATUS_CHANGED", orderId: "o1" }],
      [PDV_CD21_ROOM, { unitBusinessId: "ub1", event: "ORDER_STATUS_CHANGED", orderId: "o1" }],
    ]);
  });
});

describe("notifyPdvStoresSync", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emite 1 vez por loja distinta (só as solicitações dela) e 1 vez só pro CD21 (todas)", () => {
    notifyPdvStoresSync(
      [request("r1", "ub1"), request("r2", "ub1"), request("r3", null), request("r4", "ub2")],
      "SALES_REQUEST_STATUS_CHANGED",
    );

    const calls = (socketEmitterService.emitToNamespaceRoom as jest.Mock).mock.calls;
    expect(calls.map(([, room]) => room)).toEqual([
      pdvStoreRoom("ub1"),
      pdvStoreRoom("ub2"),
      PDV_CD21_ROOM,
    ]);
    const ids = (payload: any) => payload.requests.map((r: any) => r.requestId);
    expect(ids(calls[0][3])).toEqual(["r1", "r2"]);
    expect(ids(calls[1][3])).toEqual(["r4"]);
    expect(ids(calls[2][3])).toEqual(["r1", "r2", "r4"]);
    expect(calls[0][3].requests[0]).toEqual({
      requestId: "r1",
      status: PdvSalesRequestStatus.SHIPPING,
    });
  });

  it("sem loja nenhuma não emite", () => {
    notifyPdvStoresSync([request("r1", null)], "SALES_REQUEST_STATUS_CHANGED");

    expect(socketEmitterService.emitToNamespaceRoom).not.toHaveBeenCalled();
  });
});
