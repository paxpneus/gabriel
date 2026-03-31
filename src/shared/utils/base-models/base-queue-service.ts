import { EventEmitter } from "events";
import { redisConfig } from "./../../../config/redis";
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { redisConnection } from "./base-redis";

export abstract class BaseQueueService<T> {
  protected queue: Queue;
  protected worker: Worker;
  protected queueEvents: QueueEvents;
  public queueName: string;

  constructor(queueName: string, options: { concurrency?: number } = {}) {
    this.queueName = queueName;
    this.queue = new Queue(this.queueName, { connection: redisConfig });
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConfig,
    });

    this.worker = new Worker(this.queueName, this.process.bind(this), {
      connection: redisConnection,
      concurrency: options.concurrency ?? 2,
      limiter: {
        max: 3,
        duration: 1000,
      },
    });

    this.worker.on("failed", (job, err) => {
      console.error(`[QUEUE] Job ${job?.id} falhou:`, err.message);
    });

    this.worker.on("completed", (job) => {
      console.log(`[QUEUE] Job ${job.id} concluído com sucesso`);
    });
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
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
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
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
  }

  async scheduleRepeat(options: { every: number }): Promise<void> {
    await this.queue.add(
      this.queueName,
      {},
      {
        repeat: { every: options.every },
        removeOnComplete: true,
        removeOnFail: { count: 10 },
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
}
