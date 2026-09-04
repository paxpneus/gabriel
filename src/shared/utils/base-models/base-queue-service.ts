import { redisConfig } from "./../../../config/redis";
import { Queue, Worker, QueueEvents, Job, DelayedError } from "bullmq";
import { redisConnection } from "./base-redis";
import { randomUUID } from "crypto";
import { alertService } from "../../providers/mail-provider/nodemailer.alert";

export type baseQueueOptions = {
  concurrency?: number;
  limiter?: { max: number; duration: number };
  lockDuration?: number;
  workless?: boolean;
  maxProcessingMs?: number;
  backoffStrategy?: (
    attemptsMade: number,
    type?: string,
    err?: Error,
  ) => number;
  sharedLock?: {
    key: string;
    ttlMs?: number;
    retryDelayMs?: number;
    maxWaitMs?: number;
    priority?: {
      enabled?: boolean;
      ranks?: Record<string, number>;
      defaultRank?: number;
    };
  };
};

type SharedLockPriorityTicket = {
  waitKey: string;
  ticketKey: string;
  token: string;
  resource: string;
  rank: number;
};

export abstract class BaseQueueService<T> {
  public queue: Queue;
  protected worker: Worker | undefined;
  protected queueEvents: QueueEvents;
  public queueName: string;
  private hasCustomBackoff: boolean;
  private sharedLockPriority?: NonNullable<
    NonNullable<baseQueueOptions["sharedLock"]>["priority"]
  >;
  private workerLockDuration: number;
  private maxProcessingMs?: number;

  constructor(queueName: string, options: baseQueueOptions = {}) {
    this.queueName = queueName;
    this.hasCustomBackoff = !!options.backoffStrategy;
    this.workerLockDuration = options.lockDuration ?? 5 * 60 * 1000;
    this.queue = new Queue(this.queueName, { connection: redisConfig });
    this.maxProcessingMs = options.maxProcessingMs;

    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConfig,
    });
    this.sharedLockPriority = options.sharedLock?.priority;

    if (!options.workless) {
      const processor = options.sharedLock
        ? (job: Job<T>) => {
            const token = `${this.queueName}:${job.id ?? "no-id"}:${randomUUID()}`;
            return this.processWithSharedLock(job, options.sharedLock!, token);
          }
        : (job: Job<T>) =>
            this.runProcessWithTimeout(job, this.maxProcessingMs);

      this.worker = new Worker(this.queueName, processor, {
        connection: redisConnection,
        lockDuration: this.workerLockDuration,
        stalledInterval: 60000,
        maxStalledCount: 3,
        concurrency: options.concurrency ?? 2,
        limiter: options.limiter ?? {
          max: 3,
          duration: 1000,
        },
        ...(options.backoffStrategy
          ? { settings: { backoffStrategy: options.backoffStrategy } }
          : {}),
      });

      this.worker.on("failed", (job, err) => {
        const detail = (err as any)?.parent?.detail ?? (err as any)?.original?.detail;
        const constraint =
          (err as any)?.parent?.constraint ?? (err as any)?.original?.constraint;
        console.error(
          `[QUEUE] Job ${job?.id} falhou:`,
          err.message,
          constraint ? `| constraint=${constraint}` : "",
          detail ? `| detail=${detail}` : "",
        );
        if (job) {
          try {
            this.onFailed(job, err);
          } catch (hookError: any) {
            console.error(
              `[QUEUE] Erro ao executar onFailed para job ${job.id}:`,
              hookError.message,
            );
          }
        }
      });
    }
  }

  abstract process(job: Job<T>): Promise<void>;

  private async runProcessWithTimeout(
    job: Job<T>,
    maxProcessingMs?: number,
  ): Promise<void> {
    if (!maxProcessingMs) {
      return this.process(job);
    }

    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `[QUEUE] Job "${job.id}" da fila "${this.queueName}" excedeu ${maxProcessingMs}ms ativo — abortado pela fila.`,
          ),
        );
      }, maxProcessingMs);
    });

    try {
      await Promise.race([this.process(job), timeoutPromise]);
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }

  private async tryAcquireOnce(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    token: string,
    ttlMs: number,
    priorityTicket?: SharedLockPriorityTicket,
  ): Promise<boolean> {
    if (priorityTicket) {
      await this.cleanupSharedLockPriorityQueue(priorityTicket.waitKey);
      const isNext = await this.isNextSharedLockPriorityTicket(priorityTicket);
      if (!isNext) return false;
    }

    const acquired = await redisConnection.set(
      sharedLock.key,
      token,
      "PX",
      ttlMs,
      "NX",
    );
    return acquired === "OK";
  }

  private async processWithSharedLock(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    token: string,
  ): Promise<void> {
    const ttlMs = sharedLock.ttlMs ?? 15 * 60 * 1000;
    const retryDelayMs = sharedLock.retryDelayMs ?? 1000;

    const priorityTicket = await this.registerSharedLockPriorityTicket(
      job,
      sharedLock,
      ttlMs,
    );

    const acquired = await this.tryAcquireOnce(
      job,
      sharedLock,
      token,
      ttlMs,
      priorityTicket,
    );

    const waitedMs = Date.now() - (job.timestamp ?? Date.now());
    const maxWaitMs = sharedLock.maxWaitMs ?? 60 * 60 * 1000;

    if (!acquired) {
      if (waitedMs > maxWaitMs) {
        const alertKey = `${sharedLock.key}:alerted:${job.id}`;
        const canAlert = await redisConnection.set(
          alertKey,
          "1",
          "PX",
          10 * 60 * 1000,
          "NX",
        );
        if (canAlert === "OK") {
          alertService.sendAlert({
            severity: "HIGH",
            title: `Job "${job.id}" aguardando lock "${sharedLock.key}" há ${Math.round(waitedMs / 60000)}min`,
            message: `Fila ${this.queueName}, rank ${priorityTicket?.rank ?? "n/a"} — possível fome ou lock travado.`,
          });
        }
      }

      if (!job.token) {
        throw new Error(
          `[QUEUE] job.token ausente ao tentar delay do lock "${sharedLock.key}"`,
        );
      }
      await job.moveToDelayed(Date.now() + retryDelayMs, job.token);
      throw new DelayedError();
    }

    const workerLockInterval = setInterval(() => {
      if (job.token) {
        job.extendLock(job.token, this.workerLockDuration).catch(() => {});
      }
    }, 30_000);

    const sharedLockRefreshMs = Math.max(1000, Math.floor(ttlMs / 3));
    const sharedLockInterval = setInterval(() => {
      this.refreshSharedLock(sharedLock.key, token, ttlMs).catch(() => {});
    }, sharedLockRefreshMs);

    try {
      await this.runProcessWithTimeout(job, this.maxProcessingMs);
    } finally {
      clearInterval(workerLockInterval);
      clearInterval(sharedLockInterval);

      await this.releaseSharedLock(sharedLock.key, token).catch(() => {});

      if (priorityTicket) {
        await this.releaseSharedLockPriorityTicket(priorityTicket).catch(
          () => {},
        );
      }
    }
  }

  private async registerSharedLockPriorityTicket(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    ttlMs: number,
  ): Promise<SharedLockPriorityTicket | undefined> {
    if (!sharedLock.priority?.enabled) return undefined;

    const waitKey = `${sharedLock.key}:priority`;
    const member = String(job.id);
    const ticketKey = `${waitKey}:ticket:${member}`;
    const resource = this.resolveSharedLockResource(job);
    const rank =
      sharedLock.priority.ranks?.[resource] ??
      sharedLock.priority.defaultRank ??
      9;
    const score = rank * 100_000_000_000_000 + (job.timestamp ?? Date.now());

    await redisConnection.zadd(waitKey, "NX", score, member);
    await redisConnection.set(
      ticketKey,
      "1",
      "PX",
      Math.max(ttlMs, 5 * 60 * 1000),
    );

    return { waitKey, ticketKey, token: member, resource, rank };
  }

  private resolveSharedLockResource(job: Job<T>): string {
    return this.queueName;
  }

  private async releaseSharedLockPriorityTicket(
    ticket: SharedLockPriorityTicket,
  ): Promise<void> {
    await redisConnection.zrem(ticket.waitKey, ticket.token);
    await redisConnection.del(ticket.ticketKey);
  }

  private async isNextSharedLockPriorityTicket(
    ticket: SharedLockPriorityTicket,
  ): Promise<boolean> {
    const [nextToken] = await redisConnection.zrange(ticket.waitKey, 0, 0);
    return nextToken === ticket.token;
  }

  private async cleanupSharedLockPriorityQueue(waitKey: string): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const [candidate] = await redisConnection.zrange(waitKey, 0, 0);
      if (!candidate) return;

      const exists = await redisConnection.exists(
        `${waitKey}:ticket:${candidate}`,
      );
      if (exists) return;

      await redisConnection.zrem(waitKey, candidate);
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

  async add(data: T, jobId?: string, jobOptions?: { priority?: number }) {
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
      // BullMQ nativo: menor número = maior prioridade, jobs sem `priority`
      // ficam atrás de qualquer job que tenha uma definida. Usado pra fazer
      // um job específico furar a fila de espera de uma fila já existente,
      // sem precisar de fila/lock dedicados.
      ...(jobOptions?.priority ? { priority: jobOptions.priority } : {}),
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 3600 * 7,
      },
      attempts: 5,
      backoff: this.hasCustomBackoff
        ? { type: "custom" }
        : { type: "exponential", delay: 30000 },
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
      backoff: this.hasCustomBackoff
        ? { type: "custom" }
        : { type: "exponential", delay: 30000 },
    });
  }

  async scheduleRepeat(options: {
    every?: number;
    cron?: string;
    tz?: string;
    jobId?: string;
    data?: {
      task?: string;
    };
  }): Promise<void> {
    if (!options.every && !options.cron) {
      throw new Error("Você deve informar 'every' ou 'cron'");
    }

    await this.queue.add(this.queueName, options.data ?? {}, {
      repeat: {
        ...(options.every ? { every: options.every } : {}),
        ...(options.cron ? { pattern: options.cron } : {}),
        ...(options.tz ? { tz: options.tz } : {}),
        ...(options.jobId ? { jobId: options.jobId } : {}),
      },
      removeOnComplete: true,
      removeOnFail: {
        age: 24 * 3600 * 7,
      },
      attempts: 3,
      backoff: this.hasCustomBackoff
        ? { type: "custom" }
        : { type: "exponential", delay: 10000 },
    });

    if (options.cron) {
      console.log(
        `[QUEUE] ${this.queueName} agendado via CRON (${options.cron}) tz=${options.tz ?? "UTC"}`,
      );
    } else {
      console.log(
        `[QUEUE] ${this.queueName} agendado a cada ${options.every! / 1000}s`,
      );
    }
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
