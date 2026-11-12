// ReportQueue estende BaseQueueService (Queue/QueueEvents reais no construtor): BullMQ, Redis e services mockados.
jest.mock("../../../config/redis", () => ({ __esModule: true, redisConfig: {} }));
jest.mock("../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  redisConnection: {},
  default: {},
}));
jest.mock("../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));
jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock("../sellers-report/seller-report/seller-sales-report.service", () => ({
  __esModule: true,
  default: { runIncrementalJob: jest.fn() },
}));
jest.mock("../daily-sales/sales-report/sales-report.service", () => ({
  __esModule: true,
  default: { runIncrementalJob: jest.fn() },
}));
jest.mock("../daily-operation/daily-operation-report/daily-operation-report.service", () => ({
  __esModule: true,
  default: { runIncrementalJob: jest.fn() },
}));

import { Job } from "bullmq";
import SellerSalesReportService from "../sellers-report/seller-report/seller-sales-report.service";
import SalesReportService from "../daily-sales/sales-report/sales-report.service";
import DailyOperationReportService from "../daily-operation/daily-operation-report/daily-operation-report.service";
import { REPORT_HOURLY_TASK, ReportQueue } from "../report.queue";

// Job mínimo com a task informada.
const jobFor = (task: string) => ({ id: "job-1", data: { task } }) as Job<{ task: string }>;

describe("ReportQueue", () => {
  let queue: ReportQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new ReportQueue({ workless: true });
    (queue.queue.getJob as jest.Mock).mockResolvedValue(undefined);
  });

  it("hourly enfileira seller → sales → daily operation, sem priority e com a hora no jobId", async () => {
    await queue.process(jobFor(REPORT_HOURLY_TASK));

    const calls = (queue.queue.add as jest.Mock).mock.calls;
    expect(calls.map(([, data]) => data.task)).toEqual([
      "seller-sales-report",
      "sales-report",
      "daily-operation",
    ]);
    calls.forEach(([, data, options]) => {
      expect(options.jobId).toMatch(new RegExp(`^report-${data.task}-\\d{10}$`));
      expect(options.priority).toBeUndefined();
    });
    expect(SellerSalesReportService.runIncrementalJob).not.toHaveBeenCalled();
  });

  it.each([
    ["seller-sales-report", SellerSalesReportService],
    ["sales-report", SalesReportService],
    ["daily-operation", DailyOperationReportService],
  ])("task %s chama o runIncrementalJob do relatório certo", async (task, service) => {
    await queue.process(jobFor(task));

    expect(service.runIncrementalJob).toHaveBeenCalledTimes(1);
    const others = [SellerSalesReportService, SalesReportService, DailyOperationReportService]
      .filter((other) => other !== service);
    others.forEach((other) => expect(other.runIncrementalJob).not.toHaveBeenCalled());
  });

  it("task desconhecida lança erro", async () => {
    await expect(queue.process(jobFor("toString"))).rejects.toThrow("Task desconhecida");
  });
});
