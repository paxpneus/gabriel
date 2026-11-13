// Regressão: o "último lote de saída" do fluxo de NF-e nunca pode ser lote de nota interna.
jest.mock("../../../warehouse/expedition/batch/batch.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: {},
  redisConnection: {},
}));
jest.mock("../../users/roles/role.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../unit-business-groups/unit-business-group/unit-business-group.service", () => ({ __esModule: true, default: {} }));

import expeditionBatchService from "../../../warehouse/expedition/batch/batch.service";
import unitBusinessService from "../unit-business.service";

describe("UnitBusinessService.getOrUpdateLastOutgoingBatchNumber", () => {
  it("consulta só lotes de NF-e (is_internal false)", async () => {
    (expeditionBatchService.findOne as jest.Mock).mockResolvedValue(null);
    jest.spyOn(unitBusinessService, "update").mockResolvedValue(undefined as any);

    await unitBusinessService.getOrUpdateLastOutgoingBatchNumber("ub-1");

    expect((expeditionBatchService.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({
      unit_business_id: "ub-1",
      type: "OUTGOING",
      is_internal: false,
    });
  });
});
