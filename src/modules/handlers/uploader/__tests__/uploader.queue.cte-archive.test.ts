jest.mock("../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), eval: jest.fn(), zadd: jest.fn(), zrem: jest.fn(), zrange: jest.fn(), exists: jest.fn(), scan: jest.fn(), on: jest.fn() },
}));
jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

const mockReconcilePending = jest.fn();
const mockArchive = jest.fn();
jest.mock("../../../warehouse/fiscal/ctes/cte/services/cte-xml-archive.service", () => ({
  __esModule: true,
  default: {
    archive: (id: string) => mockArchive(id),
    reconcilePending: () => mockReconcilePending(),
  },
}));
jest.mock("../services/uploader.service", () => ({ __esModule: true, default: {} }));
jest.mock("../../temp-file/temp-file.service", () => ({ __esModule: true, default: {} }));
jest.mock("../uploader-finalizers", () => ({ FINALIZERS: {}, FINALIZE_CHECKERS: {} }));
jest.mock("../uploader-image-cache", () => ({}));

import { UploaderQueue } from "../uploader.queue";

describe("UploaderQueue — CT-e XML archive", () => {
  let queue: UploaderQueue;
  let addSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new UploaderQueue({ workless: true });
    addSpy = jest.spyOn(queue, "add").mockResolvedValue({} as any);
  });

  it("enqueues with a deterministic jobId (dedup) and CTE priority", async () => {
    await queue.enqueueCteArchive("abc");

    expect(addSpy).toHaveBeenCalledWith(
      { kind: "cte-archive", cteId: "abc" },
      "cte-archive-abc",
      { priority: 4 },
    );
  });

  it("the sweep timer only enqueues one deduped reconcile job and never touches the storage", async () => {
    await queue.enqueueCteArchiveReconcile();

    expect(addSpy).toHaveBeenCalledWith(
      { kind: "cte-archive-reconcile" },
      "cte-archive-reconcile",
      { priority: 4 },
    );
    expect(mockReconcilePending).not.toHaveBeenCalled();
  });

  it("reconcile job enqueues only the CT-es missing in the cloud, at the same priority as inline", async () => {
    mockReconcilePending.mockResolvedValue(["a", "b", "c"]);

    await queue.process({ data: { kind: "cte-archive-reconcile" } } as any);

    expect(addSpy).toHaveBeenCalledTimes(3);
    expect(addSpy).toHaveBeenCalledWith(
      { kind: "cte-archive", cteId: "b" },
      "cte-archive-b",
      { priority: 4 },
    );
  });

  it("reconcile job handles more ids than one enqueue chunk", async () => {
    mockReconcilePending.mockResolvedValue(Array.from({ length: 250 }, (_, i) => `id-${i}`));

    await queue.process({ data: { kind: "cte-archive-reconcile" } } as any);

    expect(addSpy).toHaveBeenCalledTimes(250);
  });

  it("reconcile job failure propagates (BullMQ retries) and enqueues nothing", async () => {
    mockReconcilePending.mockRejectedValue(new Error("storage 429"));

    await expect(
      queue.process({ data: { kind: "cte-archive-reconcile" } } as any),
    ).rejects.toThrow("storage 429");
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("process() delegates cte-archive jobs and lets failures propagate for BullMQ retry", async () => {
    mockArchive.mockRejectedValueOnce(new Error("upload failed"));

    await expect(
      queue.process({ data: { kind: "cte-archive", cteId: "x" } } as any),
    ).rejects.toThrow("upload failed");
    expect(mockArchive).toHaveBeenCalledWith("x");
  });
});
