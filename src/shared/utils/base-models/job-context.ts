import { AsyncLocalStorage } from "async_hooks";

// Contexto do job em execução, propagado por todo await dentro do process(job) —
// permite a limiters globais (ex.: waitForBlingRateLimit) saberem de qual faixa/job vem a chamada.
export type JobContext = {
  lane: string;
  enqueuedAt: number;
  rateLimitWait: { inFlight: number; since: number; totalMs: number };
  // Abortado quando o job estoura maxProcessingMs — o process(job) original não para sozinho (Promise.race não cancela).
  abortController: AbortController;
};

export const jobContext = new AsyncLocalStorage<JobContext>();

export function createJobContext(lane: string, enqueuedAt: number): JobContext {
  return {
    lane,
    enqueuedAt,
    rateLimitWait: { inFlight: 0, since: 0, totalMs: 0 },
    abortController: new AbortController(),
  };
}

export class JobAbortedError extends Error {
  constructor(reason: unknown) {
    super(
      `[QUEUE] Job abortado — ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    this.name = "JobAbortedError";
  }
}

// Ponto de parada do job abortado: chamar antes de começar trabalho novo (ex.: antes de pedir vaga na Bling).
export function throwIfJobAborted(): void {
  const signal = jobContext.getStore()?.abortController.signal;
  if (signal?.aborted) throw new JobAbortedError(signal.reason);
}

// sleep que acorda e lança JobAbortedError se o job for abortado no meio; fora de job é um sleep comum.
export function sleepUnlessJobAborted(ms: number): Promise<void> {
  const signal = jobContext.getStore()?.abortController.signal;
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new JobAbortedError(signal.reason));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new JobAbortedError(signal.reason));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Marca `fn` como espera de rate limit (descontada do maxProcessingMs); esperas paralelas do mesmo job contam uma vez só.
export async function trackRateLimitWait<R>(fn: () => Promise<R>): Promise<R> {
  const wait = jobContext.getStore()?.rateLimitWait;
  if (!wait) return fn();

  if (wait.inFlight++ === 0) wait.since = Date.now();
  try {
    return await fn();
  } finally {
    if (--wait.inFlight === 0) wait.totalMs += Date.now() - wait.since;
  }
}

export function rateLimitWaitMs(context: JobContext): number {
  const { inFlight, since, totalMs } = context.rateLimitWait;
  return totalMs + (inFlight > 0 ? Date.now() - since : 0);
}
