import { redisConfig } from "./../../../config/redis";
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { redisConnection } from "./base-redis";
import { randomUUID } from "crypto";

export type baseQueueOptions = {
  concurrency?: number;
  limiter?: { max: number; duration: number };
  lockDuration?: number;
  workless?: boolean;
  sharedLock?: {
    key: string;
    ttlMs?: number;
    retryDelayMs?: number;
  };
};

export abstract class BaseQueueService<T> {
  public queue: Queue;
  protected worker: Worker | undefined;
  protected queueEvents: QueueEvents;
  public queueName: string;

  constructor(
    queueName: string,
    options: {
      concurrency?: number;
      limiter?: { max: number; duration: number };
      lockDuration?: number;
      workless?: boolean;
      sharedLock?: {
        key: string;
        ttlMs?: number;
        retryDelayMs?: number;
      };
    } = {},
  ) {
    this.queueName = queueName;
    this.queue = new Queue(this.queueName, { connection: redisConfig });
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConfig,
    });

    if (!options.workless) {
      const processor = options.sharedLock
        ? (job: Job<T>) => this.processWithSharedLock(job, options.sharedLock!)
        : this.process.bind(this);

      this.worker = new Worker(this.queueName, processor, {
        connection: redisConnection,
        lockDuration: options.lockDuration ?? 30000,
        stalledInterval: 30000,
        maxStalledCount: 1,
        concurrency: options.concurrency ?? 2,
        limiter: options.limiter ?? {
          max: 3,
          duration: 1000,
        },
      });

      this.worker.on("failed", (job, err) => {
        console.error(`[QUEUE] Job ${job?.id} falhou:`, err.message);
      });

      this.worker.on("completed", (job, err) => {
        console.log(`[QUEUE] Job ${job.id} concluído com sucesso`);

        if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
          this.onFailed(job, err);
        }
      });
    }
  }

  abstract process(job: Job<T>): Promise<void>;

  private async processWithSharedLock(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
  ): Promise<void> {
    const token = `${this.queueName}:${job.id ?? "no-id"}:${randomUUID()}`;
    const ttlMs = sharedLock.ttlMs ?? 15 * 60 * 1000;
    const retryDelayMs = sharedLock.retryDelayMs ?? 1000;

    await this.acquireSharedLock(sharedLock.key, token, ttlMs, retryDelayMs);

    const refreshInterval = setInterval(() => {
      this.refreshSharedLock(sharedLock.key, token, ttlMs).catch((error) => {
        console.error(
          `[QUEUE] Falha ao renovar lock compartilhado ${sharedLock.key}:`,
          error.message,
        );
      });
    }, Math.max(1000, Math.floor(ttlMs / 3)));

    try {
      await this.process(job);
    } finally {
      clearInterval(refreshInterval);
      await this.releaseSharedLock(sharedLock.key, token);
    }
  }

  private async acquireSharedLock(
    key: string,
    token: string,
    ttlMs: number,
    retryDelayMs: number,
  ): Promise<void> {
    while (true) {
      const acquired = await redisConnection.set(key, token, "PX", ttlMs, "NX");
      if (acquired === "OK") return;

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  private async refreshSharedLock(
    key: string,
    token: string,
    ttlMs: number,
  ): Promise<void> {
    await redisConnection.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("PEXPIRE", KEYS[1], ARGV[2])
      end
      return 0
      `,
      1,
      key,
      token,
      String(ttlMs),
    );
  }

  private async releaseSharedLock(key: string, token: string): Promise<void> {
    await redisConnection.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
      `,
      1,
      key,
      token,
    );
  }

  async add(data: T, jobId?: string) {
    if (jobId) {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "failed") {
          await existingJob.remove();
          console.log(`[QUEUE] Job ${jobId} removido para reprocessamento`);
        }
      }
    }

    return this.queue.add(this.queueName, data, {
      jobId,
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 3600 * 7,
      },
      attempts: 5,
      backoff: { type: "exponential", delay: 30000 },
    });
  }

  async addDelayed(data: T, jobId: string, delayMs: number) {
    if (jobId) {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "failed") {
          await existingJob.remove();
          console.log(
            `[QUEUE] Job ${jobId} com delay removido para reprocessamento`,
          );
        }
      }
    }

    return this.queue.add(this.queueName, data, {
      jobId,
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 3600 * 7,
      },
      attempts: 5,
      backoff: { type: "exponential", delay: 30000 },
    });
  }

  async scheduleRepeat(options: { every: number }): Promise<void> {
    await this.queue.add(
      this.queueName,
      {},
      {
        repeat: { every: options.every },
        removeOnComplete: true,
        removeOnFail: {
          age: 24 * 3600 * 7,
        },
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
      },
    );
    console.log(
      `[QUEUE] ${this.queueName} agendado para repetir a cada ${options.every / 1000}s`,
    );
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`[QUEUE] Job ${jobId} removido`);
    }
  }

  async getJob(jobId: string) {
    return this.queue.getJob(jobId);
  }

  protected onFailed(job: Job<T>, error: Error): void {}
}
