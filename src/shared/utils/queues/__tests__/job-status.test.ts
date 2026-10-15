// Normalização de estado de job BullMQ usada pelo unmapped e pelo manual-import.
import { toJobStatus } from "../job-status";

const job = (state: string, extra: Record<string, unknown> = {}) =>
  ({ getState: jest.fn().mockResolvedValue(state), ...extra }) as any;

describe("toJobStatus", () => {
  it("sem job: not_found", async () => {
    expect(await toJobStatus(null)).toEqual({ status: "not_found" });
  });

  it("prioritized vira waiting", async () => {
    expect(await toJobStatus(job("prioritized"))).toEqual({ status: "waiting" });
  });

  it("failed traz o failedReason como error", async () => {
    expect(await toJobStatus(job("failed", { failedReason: "boom" }))).toEqual({
      status: "failed",
      error: "boom",
    });
  });

  it("estados conhecidos passam direto; o resto vira unknown", async () => {
    for (const state of ["waiting", "active", "delayed", "completed"]) {
      expect(await toJobStatus(job(state))).toEqual({ status: state });
    }
    expect(await toJobStatus(job("waiting-children"))).toEqual({ status: "unknown" });
  });
});
