// BaseQueueService cria Queue/QueueEvents reais no construtor: BullMQ e Redis mockados.
jest.mock("../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
}));
jest.mock("../base-redis", () => ({
  __esModule: true,
  redisConnection: {},
  default: {},
}));
jest.mock("../../../providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));
jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
}));

import { BaseQueueService } from "../base-queue-service";

// Fila mínima pra exercitar add/addDelayed da base.
class TestQueue extends BaseQueueService<{ id: number }> {
  async process(): Promise<void> {}
}

// Job existente simulado num estado do BullMQ.
const jobIn = (state: string) => ({
  getState: jest.fn().mockResolvedValue(state),
  remove: jest.fn().mockResolvedValue(undefined),
});

// jobId passado pro queue.add na última chamada.
const addedJobId = (queue: TestQueue) =>
  (queue.queue.add as jest.Mock).mock.lastCall[2].jobId;

describe("BaseQueueService rerunWhileActive", () => {
  let queue: TestQueue;
  let jobs: Record<string, ReturnType<typeof jobIn>>;

  beforeEach(() => {
    queue = new TestQueue("TEST", { workless: true, rerunWhileActive: true });
    jobs = {};
    (queue.queue.getJob as jest.Mock).mockImplementation(async (id: string) => jobs[id]);
  });

  it("job ativo → add enfileira com o jobId -rerun", async () => {
    jobs["order-1"] = jobIn("active");

    await queue.add({ id: 1 }, "order-1");

    expect(addedJobId(queue)).toBe("order-1-rerun");
  });

  it("job ativo → addDelayed enfileira -rerun com o mesmo delay", async () => {
    jobs["order-1"] = jobIn("active");

    await queue.addDelayed({ id: 1 }, "order-1", 5_000);

    const [, , options] = (queue.queue.add as jest.Mock).mock.lastCall;
    expect(options.jobId).toBe("order-1-rerun");
    expect(options.delay).toBe(5_000);
  });

  it("rerun anterior em failed é removido antes de reenfileirar", async () => {
    jobs["order-1"] = jobIn("active");
    jobs["order-1-rerun"] = jobIn("failed");

    await queue.add({ id: 1 }, "order-1");

    expect(jobs["order-1-rerun"].remove).toHaveBeenCalled();
    expect(addedJobId(queue)).toBe("order-1-rerun");
  });

  it("job em delayed → mantém o mesmo jobId (BullMQ ignora o add)", async () => {
    jobs["order-1"] = jobIn("delayed");

    await queue.addDelayed({ id: 1 }, "order-1", 5_000);

    expect(addedJobId(queue)).toBe("order-1");
  });

  it("job em failed → remove e reenfileira com o mesmo jobId", async () => {
    jobs["order-1"] = jobIn("failed");

    await queue.add({ id: 1 }, "order-1");

    expect(jobs["order-1"].remove).toHaveBeenCalled();
    expect(addedJobId(queue)).toBe("order-1");
  });

  it("opção desligada → job ativo mantém o mesmo jobId (comportamento antigo)", async () => {
    const plain = new TestQueue("TEST", { workless: true });
    (plain.queue.getJob as jest.Mock).mockResolvedValue(jobIn("active"));

    await plain.add({ id: 1 }, "order-1");

    expect(addedJobId(plain)).toBe("order-1");
  });
});
