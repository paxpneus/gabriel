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
    // true: o construtor NÃO envolve o process(job) inteiro com o lock — a
    // fila é responsável por chamar withSharedLock() ela mesma, em volta de
    // cada unidade de trabalho dentro do seu próprio loop (ex: por pedido).
    // Necessário pra filas que iteram sobre muitos itens numa única
    // execução (ex: reconcilers de paginação): sem isso, o lock fica preso
    // pelo job inteiro (podendo levar minutos, sujeito só ao
    // maxProcessingMs), travando toda fila de rank mais alto que aparecer
    // no meio do loop — visto em produção: BLING_RECONCILER (rank 9, o
    // mais baixo) segurando o lock por um loop de dezenas/centenas de
    // pedidos, bloqueando NFE_EMISSION/NFE_RECONCILER (ranks 1-2) o tempo
    // todo até o loop terminar.
    manual?: boolean;
    priority?: {
      enabled?: boolean;
      ranks?: Record<string, number>;
      defaultRank?: number;
      // A cada `agingIntervalMs` esperando, o rank efetivo do ticket melhora em 1
      // (nunca passa de 1, o melhor). Sem isso um rank baixo sob tráfego alto e
      // sustentado de rank mais alto nunca roda (visto em produção: ML_ORDER_SYNC
      // rank 7 travado atrás de BLING_API_FETCH contínuo). Default 2min.
      agingIntervalMs?: number;
    };
  };
};

type SharedLockPriorityTicket = {
  waitKey: string;
  ticketKey: string;
  token: string;
  resource: string;
  rank: number;
  timestamp: number;
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
      const processor =
        options.sharedLock && !options.sharedLock.manual
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
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    token: string,
    ttlMs: number,
    priorityTicket?: SharedLockPriorityTicket,
  ): Promise<boolean> {
    if (priorityTicket) {
      await this.cleanupSharedLockPriorityQueue(priorityTicket.waitKey);
      await this.applySharedLockPriorityAging(priorityTicket, sharedLock);
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
      String(job.id ?? "no-id"),
      job.timestamp ?? Date.now(),
      sharedLock,
      ttlMs,
    );

    const acquired = await this.tryAcquireOnce(
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
    member: string,
    timestamp: number,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    ttlMs: number,
  ): Promise<SharedLockPriorityTicket | undefined> {
    if (!sharedLock.priority?.enabled) return undefined;

    const waitKey = `${sharedLock.key}:priority`;
    const ticketKey = `${waitKey}:ticket:${member}`;
    const resource = this.queueName;
    const rank =
      sharedLock.priority.ranks?.[resource] ??
      sharedLock.priority.defaultRank ??
      9;
    const score = rank * 100_000_000_000_000 + timestamp;

    await redisConnection.zadd(waitKey, "NX", score, member);
    await redisConnection.set(
      ticketKey,
      "1",
      "PX",
      Math.max(ttlMs, 5 * 60 * 1000),
    );

    return { waitKey, ticketKey, token: member, resource, rank, timestamp };
  }

  // Versão de withSharedLock: pega e solta o lock em volta de UMA unidade de
  // trabalho (ex: uma chamada Bling dentro de um loop), em vez do job(job)
  // inteiro. Usar quando a fila tem sharedLock.manual=true — nesse caso o
  // construtor não envolve process() automaticamente, e a fila deve chamar
  // isso ela mesma dentro do seu loop, uma vez por item/chamada.
  async withSharedLock<R>(
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
    fn: () => Promise<R>,
  ): Promise<R> {
    const ttlMs = sharedLock.ttlMs ?? 15 * 60 * 1000;
    const retryDelayMs = sharedLock.retryDelayMs ?? 1000;
    const maxWaitMs = sharedLock.maxWaitMs ?? 60 * 60 * 1000;
    const startedAt = Date.now();
    const token = `${this.queueName}:manual:${randomUUID()}`;

    const priorityTicket = await this.registerSharedLockPriorityTicket(
      token,
      startedAt,
      sharedLock,
      ttlMs,
    );

    let alerted = false;

    try {
      while (true) {
        const acquired = await this.tryAcquireOnce(
          sharedLock,
          token,
          ttlMs,
          priorityTicket,
        );
        if (acquired) break;

        const waitedMs = Date.now() - startedAt;
        if (waitedMs > maxWaitMs && !alerted) {
          alerted = true;
          alertService.sendAlert({
            severity: "HIGH",
            title: `[${this.queueName}] aguardando lock "${sharedLock.key}" há ${Math.round(waitedMs / 60000)}min`,
            message: `Aquisição manual dentro de um loop, rank ${priorityTicket?.rank ?? "n/a"} — possível fome ou lock travado.`,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }

      const refreshMs = Math.max(1000, Math.floor(ttlMs / 3));
      const refreshInterval = setInterval(() => {
        this.refreshSharedLock(sharedLock.key, token, ttlMs).catch(() => {});
      }, refreshMs);

      try {
        return await fn();
      } finally {
        clearInterval(refreshInterval);
        await this.releaseSharedLock(sharedLock.key, token).catch(() => {});
      }
    } finally {
      if (priorityTicket) {
        await this.releaseSharedLockPriorityTicket(priorityTicket).catch(
          () => {},
        );
      }
    }
  }

  // Lock por ENTIDADE (ex: um pedido), não por fila. Diferente de
  // withSharedLock (um recurso único global, com ranking/aging entre
  // filas), aqui a chave é dinâmica por chamada — então duas filas
  // diferentes só disputam quando tocam literalmente o MESMO pedido ao
  // mesmo tempo (raro), e pedidos diferentes correm 100% em paralelo,
  // inclusive entre filas diferentes do pipeline (BLING_ORDER_INGESTION →
  // CNPJ_VERIFY_CNAE → ML_ORDER_SYNC → NFE_EMISSION). Não usa fila de
  // prioridade/aging — contenção rara não precisa disso, um retry simples
  // e limitado basta; se estourar maxWaitMs, lança erro e deixa o job
  // falhar/tentar de novo pelo mecanismo normal de retry do BullMQ.
  async withOrderLock<R>(
    orderKey: string | number,
    fn: () => Promise<R>,
    options?: { ttlMs?: number; retryDelayMs?: number; maxWaitMs?: number },
  ): Promise<R> {
    const key = `locks:bling:order:${orderKey}`;
    const ttlMs = options?.ttlMs ?? 2 * 60 * 1000;
    const retryDelayMs = options?.retryDelayMs ?? 300;
    const maxWaitMs = options?.maxWaitMs ?? 2 * 60 * 1000;
    const token = `${this.queueName}:order:${orderKey}:${randomUUID()}`;
    const startedAt = Date.now();

    while (true) {
      const acquired = await redisConnection.set(key, token, "PX", ttlMs, "NX");
      if (acquired === "OK") break;

      if (Date.now() - startedAt > maxWaitMs) {
        throw new Error(
          `[QUEUE] Timeout aguardando lock do pedido "${orderKey}" (fila ${this.queueName}) — outra fila deve estar processando o mesmo pedido.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    const refreshMs = Math.max(1000, Math.floor(ttlMs / 3));
    const refreshInterval = setInterval(() => {
      this.refreshSharedLock(key, token, ttlMs).catch(() => {});
    }, refreshMs);

    try {
      return await fn();
    } finally {
      clearInterval(refreshInterval);
      await this.releaseSharedLock(key, token).catch(() => {});
    }
  }

  async hasPendingJobs(): Promise<boolean> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "prioritized",
    );
    return Object.values(counts).some((count) => count > 0);
  }

  // Espera esta fila ficar sem nenhum job pendente, de forma event-driven —
  // não faz polling: fica bloqueada no evento "drained" do BullMQ (disparado
  // via Redis Stream quando a lista de espera esvazia), não numa checagem
  // por intervalo. Reconfere hasPendingJobs() a cada acordar porque
  // "drained" dispara com a lista de espera vazia mesmo que ainda haja jobs
  // *ativos* em andamento (concurrency > 1) — só retorna true quando
  // realmente não sobra nada. Retorna false se estourar maxWaitMs.
  async waitUntilIdle(maxWaitMs: number): Promise<boolean> {
    const startedAt = Date.now();

    while (await this.hasPendingJobs()) {
      const remaining = maxWaitMs - (Date.now() - startedAt);
      if (remaining <= 0) return false;

      await new Promise<void>((resolve) => {
        const onDrained = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          this.queueEvents.off("drained", onDrained);
          resolve();
        }, remaining);
        this.queueEvents.once("drained", onDrained);
      });
    }

    return true;
  }

  // Promove o rank efetivo do ticket com base no tempo de espera, pra um rank
  // baixo não ficar preso pra sempre atrás de tráfego contínuo de rank mais
  // alto (ex: ML_ORDER_SYNC atrás de BLING_API_FETCH). Nunca passa do rank 1.
  private async applySharedLockPriorityAging(
    ticket: SharedLockPriorityTicket,
    sharedLock: NonNullable<baseQueueOptions["sharedLock"]>,
  ): Promise<void> {
    const agingIntervalMs = sharedLock.priority?.agingIntervalMs ?? 2 * 60 * 1000;
    if (!agingIntervalMs || agingIntervalMs <= 0) return;

    const waitedMs = Date.now() - ticket.timestamp;
    const promotions = Math.floor(waitedMs / agingIntervalMs);
    if (promotions <= 0) return;

    const effectiveRank = Math.max(1, ticket.rank - promotions);
    const score = effectiveRank * 100_000_000_000_000 + ticket.timestamp;

    // LT: só atualiza se o novo score for MENOR (melhor) que o atual — score
    // baixo é o que ZRANGE 0,0 escolhe primeiro.
    await redisConnection.zadd(ticket.waitKey, "LT", score, ticket.token);
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

  async add(
    data: T,
    jobId?: string,
    jobOptions?: {
      priority?: number;
      removeOnComplete?: boolean | { age: number; count?: number };
    },
  ) {
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
      // Default true: filas de alto volume (sync normal) não devem acumular
      // job concluído no Redis. Jobs cujo resultado alguém vai consultar
      // depois (ex.: criação de produto, consultada via getJob) devem
      // passar um removeOnComplete com retenção (ex.: { age: 24*3600 }),
      // senão o job some do Redis assim que termina com sucesso e getJob
      // nunca encontra "completed" — só "not_found".
      removeOnComplete: jobOptions?.removeOnComplete ?? true,
      removeOnFail: {
        age: 24 * 3600 * 7,
      },
      // attempts/backoff pensados pra falhas transitórias (rede, rate
      // limit). Erros permanentes (dado inválido, conflito) não devem
      // esperar essas tentativas — o processor lança UnrecoverableError
      // (bullmq) nesses casos, que pula direto pra "failed" independente
      // de quantas tentativas ainda restam (ver createProductFromBlingData/
      // createProductFromTCarData).
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
