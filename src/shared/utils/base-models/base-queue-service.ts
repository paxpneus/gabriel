import { EventEmitter } from "events";
import { redisConfig } from "./../../../config/redis";
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { redisConnection } from "./base-redis";

export type baseQueueOptions = {
  concurrency?: number;
  limiter?: { max: number; duration: number };
  lockDuration?: number;
  workless?: boolean;
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
    } = {},
  ) {
    this.queueName = queueName;
    this.queue = new Queue(this.queueName, { connection: redisConfig });
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConfig,
    });

    if (!options.workless) {
      this.worker = new Worker(this.queueName, this.process.bind(this), {
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
