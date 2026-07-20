import { redisConfig } from "./../../../config/redis";
import { Queue, Worker, QueueEvents, Job } from "bullmq";
import { redisConnection } from "./base-redis";
import { randomUUID } from "crypto";
import { alertService } from "../../providers/mail-provider/nodemailer.alert";

export type baseQueueOptions = {
  concurrency?: number;
  limiter?: { max: number; duration: number };
  lockDuration?: number;
  workless?: boolean;
  backoffStrategy?: (attemptsMade: number, type: string, err: Error) => number; // ← faltou aqui
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

  constructor(
    queueName: string,
    options: {
      concurrency?: number;
      limiter?: { max: number; duration: number };
      lockDuration?: number;
      workless?: boolean;
      backoffStrategy?: (
        attemptsMade: number,
        type: string,
        err: Error,
      ) => number;
      sharedLock?: {
        key: string;
        ttlMs?: number;
        retryDelayMs?: number;
        priority?: {
          enabled?: boolean;
          ranks?: Record<string, number>;
          defaultRank?: number;
        };
      };
    } = {},
  ) {
    this.queueName = queueName;
    this.hasCustomBackoff = !!options.backoffStrategy;
    this.workerLockDuration = options.lockDuration ?? 5 * 60 * 1000;
    this.queue = new Queue(this.queueName, { connection: redisConfig });
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: redisConfig,
    });
    this.sharedLockPriority = options.sharedLock?.priority;

    if (!options.workless) {
      const processor = options.sharedLock
        ? (job: Job<T>) => this.processWithSharedLock(job, options.sharedLock!)
        : this.process.bind(this);

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
          ? { backoffStrategy: options.backoffStrategy }
          : {}),
      });

      this.worker.on("failed", (job, err) => {
        console.error(`[QUEUE] Job ${job?.id} falhou:`, err.message);
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

  private async processWithSharedLock(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
  ): Promise<void> {
    const token = `${this.queueName}:${job.id ?? "no-id"}:${randomUUID()}`;
    const ttlMs = sharedLock.ttlMs ?? 15 * 60 * 1000;
    const retryDelayMs = sharedLock.retryDelayMs ?? 1000;
    const priorityTicket = await this.registerSharedLockPriorityTicket(
      job,
      sharedLock,
      token,
      ttlMs,
    );

    const workerLockRefreshMs = 30_000;
    const sharedLockRefreshMs = Math.max(1000, Math.floor(ttlMs / 3));

    const workerLockInterval = setInterval(() => {
      if (job.token) {
        job.extendLock(job.token, this.workerLockDuration).catch((error) => {
          console.warn(
            `[QUEUE] Falha ao renovar worker lock ${job.id}:`,
            error.message,
          );
        });
      }
    }, workerLockRefreshMs);

    const sharedLockInterval = setInterval(() => {
      this.refreshSharedLock(sharedLock.key, token, ttlMs).catch((error) => {
        console.error(
          `[QUEUE] Falha ao renovar lock compartilhado ${sharedLock.key}:`,
          error.message,
        );
      });
      if (priorityTicket) {
        this.refreshSharedLockPriorityTicket(priorityTicket, ttlMs).catch(
          (error) => {
            console.error(
              `[QUEUE] Falha ao renovar ticket de prioridade ${priorityTicket.ticketKey}:`,
              error.message,
            );
          },
        );
      }
    }, sharedLockRefreshMs);

    try {
      await this.acquireSharedLock(
        sharedLock,
        token,
        ttlMs,
        retryDelayMs,
        priorityTicket,
      );
      await this.process(job);
    } finally {
      clearInterval(workerLockInterval);
      clearInterval(sharedLockInterval);

      try {
        await this.releaseSharedLock(sharedLock.key, token);
      } catch (error: any) {
        console.error(
          `[QUEUE] Falha ao liberar lock compartilhado ${sharedLock.key}:`,
          error.message,
        );
      }

      if (priorityTicket) {
        try {
          await this.releaseSharedLockPriorityTicket(priorityTicket);
        } catch (error: any) {
          console.error(
            `[QUEUE] Falha ao liberar ticket de prioridade ${priorityTicket.ticketKey}:`,
            error.message,
          );
        }
      }
    }
  }

  private async acquireSharedLock(
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    token: string,
    ttlMs: number,
    retryDelayMs: number,
    priorityTicket?: SharedLockPriorityTicket,
  ): Promise<void> {
    // Semáforo: enquanto houver alguém à frente (ativo ou com prioridade
    // maior aguardando), o job espera indefinidamente — isso NÃO é falha,
    // é comportamento esperado de tráfego. Só entra "ativo" quando for
    // realmente a vez dele. Sem timeout artificial de espera.
    const maxWaitMs = sharedLock.maxWaitMs ?? 24 * 60 * 60 * 1000; // 1 dia
    const startedAt = Date.now();
    let lastLogAt = 0;
    const LOG_INTERVAL_MS = 60_000;

    while (true) {
      const waitedMs = Date.now() - startedAt;

      if (waitedMs > maxWaitMs) {
        alertService.sendAlert({
          severity: "CRITICAL",
          title: `Lock compartilhado "${sharedLock.key}" — espera excedeu 1 dia`,
          message: `Fila ${this.queueName} esperou ${Math.round(waitedMs / 3_600_000)}h pelo lock e desistiu. Provável lock travado ou fome severa — investigar filas concorrentes.`,
        });
        throw new Error(
          `[QUEUE] Timeout aguardando lock compartilhado "${sharedLock.key}" (esperou ${waitedMs}ms, limite ${maxWaitMs}ms)`,
        );
      }

      if (priorityTicket) {
        await this.cleanupSharedLockPriorityQueue(priorityTicket.waitKey);
        const isNext =
          await this.isNextSharedLockPriorityTicket(priorityTicket);

        if (!isNext) {
          if (waitedMs - lastLogAt >= LOG_INTERVAL_MS) {
            lastLogAt = waitedMs;
            console.log(
              `[QUEUE] ${this.queueName} (rank ${priorityTicket.rank}) aguardando vez no lock "${sharedLock.key}" há ${Math.round(waitedMs / 1000)}s — filas de maior prioridade na frente.`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
      }

      const acquired = await redisConnection.set(
        sharedLock.key,
        token,
        "PX",
        ttlMs,
        "NX",
      );
      if (acquired === "OK") return;

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  private async registerSharedLockPriorityTicket(
    job: Job<T>,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    token: string,
    ttlMs: number,
  ): Promise<SharedLockPriorityTicket | undefined> {
    if (!sharedLock.priority?.enabled) return undefined;

    const waitKey = `${sharedLock.key}:priority`;
    const ticketKey = `${waitKey}:ticket:${token}`;
    const resource = this.resolveSharedLockResource(job);
    const rank =
      sharedLock.priority.ranks?.[resource] ??
      sharedLock.priority.defaultRank ??
      9;
    const score = rank * 100_000_000_000_000 + (job.timestamp ?? Date.now());

    await redisConnection.zadd(waitKey, score, token);
    await redisConnection.set(ticketKey, "1", "PX", ttlMs);

    return {
      waitKey,
      ticketKey,
      token,
      resource,
      rank,
    };
  }

  private resolveSharedLockResource(job: Job<T>): string {
    return this.queueName;
  }

  private resolveSharedLockResourceFromData(data: unknown): string {
    const payload = data as Record<string, any> | undefined;

    if (typeof payload?.resource === "string") return payload.resource;
    if (typeof payload?.apiFetch?.resource === "string") {
      return payload.apiFetch.resource;
    }
    if (typeof payload?.event === "string") {
      return payload.event.split(".")[0];
    }
    if (this.queueName === "BLING_ORDER_INGESTION") return "order";

    return "default";
  }

  private resolveJobPriority(data: T): number | undefined {
    if (!this.sharedLockPriority?.enabled) return undefined;

    const resource = this.resolveSharedLockResourceFromData(data);
    return (
      this.sharedLockPriority.ranks?.[resource] ??
      this.sharedLockPriority.defaultRank
    );
  }

  private async refreshSharedLockPriorityTicket(
    ticket: SharedLockPriorityTicket,
    ttlMs: number,
  ): Promise<void> {
    await redisConnection.pexpire(ticket.ticketKey, ttlMs);
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
  }): Promise<void> {
    if (!options.every && !options.cron) {
      throw new Error("Você deve informar 'every' ou 'cron'");
    }

    await this.queue.add(
      this.queueName,
      {},
      {
        repeat: {
          ...(options.every ? { every: options.every } : {}),
          ...(options.cron ? { pattern: options.cron } : {}),
          ...(options.tz ? { tz: options.tz } : {}),
        },
        removeOnComplete: true,
        removeOnFail: {
          age: 24 * 3600 * 7,
        },
        attempts: 3,
        backoff: this.hasCustomBackoff
          ? { type: "custom" }
          : { type: "exponential", delay: 10000 },
      },
    );

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
