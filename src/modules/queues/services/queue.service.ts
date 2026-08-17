import { Queue, Job } from "bullmq";
import { ALL_STATUSES, QueueJobStatus, QueueJobSummary, QueueOverview } from "../types/queue.types";

export class QueueMonitorService {
  private static registry = new Map<string, Queue>();

  registerQueue(name: string, queueOrWrapper: Queue | { queue?: Queue }): void {
    const queue =
      queueOrWrapper instanceof Queue ? queueOrWrapper : queueOrWrapper?.queue;

    if (!queue) {
      console.warn(`[QUEUE_MONITOR] Fila "${name}" inválida — não registrada.`);
      return;
    }

    QueueMonitorService.registry.set(name, queue);
    console.log(`[QUEUE_MONITOR] Fila registrada: ${name}`);
  }

  registerFromLocals(
    locals: Record<string, any>,
    map: Record<string, string>,
  ): void {
    for (const [localsKey, queueName] of Object.entries(map)) {
      const wrapper = locals[localsKey];
      if (wrapper?.queue) this.registerQueue(queueName, wrapper.queue);
      else
        console.warn(
          `[QUEUE_MONITOR] locals.${localsKey} ausente ou sem .queue — "${queueName}" não registrada.`,
        );
    }
  }

  listRegisteredQueues(): string[] {
    return [...QueueMonitorService.registry.keys()];
  }

  private resolveQueue(name: string): Queue {
    const queue = QueueMonitorService.registry.get(name);
    if (!queue) {
      throw new Error(
        `[QUEUE_MONITOR] Fila "${name}" não registrada. Filas disponíveis: ${this.listRegisteredQueues().join(", ") || "nenhuma"}`,
      );
    }
    return queue;
  }

  async getQueueOverview(name: string): Promise<QueueOverview> {
    const queue = this.resolveQueue(name);
    const [counts, isPaused] = await Promise.all([
      queue.getJobCounts(...ALL_STATUSES),
      queue.isPaused(),
    ]);
    return { name, isPaused, counts };
  }

  async getAllQueuesOverview(): Promise<QueueOverview[]> {
    return Promise.all(
      this.listRegisteredQueues().map((name) => this.getQueueOverview(name)),
    );
  }

  async getJobs(
    name: string,
    status: QueueJobStatus = "waiting",
    start = 0,
    end = 20,
  ): Promise<QueueJobSummary[]> {
    const queue = this.resolveQueue(name);
    const jobs = await queue.getJobs([status], start, end);
    return Promise.all(jobs.map((job) => this.toSummary(job)));
  }

  async getJob(name: string, jobId: string): Promise<QueueJobSummary | null> {
    const queue = this.resolveQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) return null;
    return this.toSummary(job);
  }

  private async toSummary(job: Job): Promise<QueueJobSummary> {
    const status = await job.getState().catch(() => "unknown");
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      status,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
    };
  }

  async retryJob(name: string, jobId: string): Promise<boolean> {
    const queue = this.resolveQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) return false;
    await job.retry();
    console.log(`[QUEUE_MONITOR] Job ${jobId} da fila ${name} reprocessado.`);
    return true;
  }

  async removeJob(name: string, jobId: string): Promise<boolean> {
    const queue = this.resolveQueue(name);
    const job = await queue.getJob(jobId);
    if (!job) return false;
    await job.remove();
    console.log(`[QUEUE_MONITOR] Job ${jobId} da fila ${name} removido.`);
    return true;
  }

  async pauseQueue(name: string): Promise<void> {
    await this.resolveQueue(name).pause();
    console.log(`[QUEUE_MONITOR] Fila ${name} pausada.`);
  }

  async resumeQueue(name: string): Promise<void> {
    await this.resolveQueue(name).resume();
    console.log(`[QUEUE_MONITOR] Fila ${name} retomada.`);
  }

  async cleanQueue(
    name: string,
    status: "completed" | "failed",
    olderThanMs = 24 * 60 * 60 * 1000,
    limit = 1000,
  ): Promise<string[]> {
    const queue = this.resolveQueue(name);
    const removedIds = await queue.clean(olderThanMs, limit, status);
    console.log(
      `[QUEUE_MONITOR] Fila ${name} limpa: ${removedIds.length} job(s) "${status}" removido(s).`,
    );
    return removedIds;
  }
}

export default new QueueMonitorService();