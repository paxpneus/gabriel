jest.mock("../../../../../handlers/socket/services/socket-emitter.service", () => ({
  __esModule: true,
  default: { emitToNamespaceRoom: jest.fn() },
}));

import socketEmitterService from "../../../../../handlers/socket/services/socket-emitter.service";
import { notifyPdvStoresSync } from "../notify-pdv-store-sync";
import { PDV_CD21_ROOM, pdvStoreRoom } from "../pdv-sales-request-room";

describe("notifyPdvStoresSync", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emite 1 vez por loja distinta e 1 vez só pro CD21", () => {
    notifyPdvStoresSync(["ub1", "ub1", null, "ub2"], "SALES_REQUEST_STATUS_CHANGED");

    const rooms = (socketEmitterService.emitToNamespaceRoom as jest.Mock).mock.calls.map(
      ([, room]) => room,
    );
    expect(rooms).toEqual([pdvStoreRoom("ub1"), pdvStoreRoom("ub2"), PDV_CD21_ROOM]);
  });

  it("sem loja nenhuma não emite", () => {
    notifyPdvStoresSync([null, undefined], "SALES_REQUEST_STATUS_CHANGED");

    expect(socketEmitterService.emitToNamespaceRoom).not.toHaveBeenCalled();
  });
});
