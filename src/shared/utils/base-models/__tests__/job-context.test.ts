import {
  createJobContext,
  JobAbortedError,
  jobContext,
  rateLimitWaitMs,
  sleepUnlessJobAborted,
  throwIfJobAborted,
  trackRateLimitWait,
} from "../job-context";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("trackRateLimitWait", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("soma o tempo de espera no contexto do job", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = trackRateLimitWait(() => sleep(1000));
      await jest.advanceTimersByTimeAsync(1000);
      await pending;
    });

    expect(rateLimitWaitMs(context)).toBe(1000);
  });

  it("esperas paralelas do mesmo job contam uma vez só (tempo de parede, não soma)", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = Promise.all([
        trackRateLimitWait(() => sleep(1000)),
        trackRateLimitWait(() => sleep(600)),
      ]);
      await jest.advanceTimersByTimeAsync(1000);
      await pending;
    });

    expect(rateLimitWaitMs(context)).toBe(1000);
  });

  it("espera em andamento já conta antes de terminar", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = trackRateLimitWait(() => sleep(1000));
      await jest.advanceTimersByTimeAsync(400);
      expect(rateLimitWaitMs(context)).toBe(400);
      await jest.advanceTimersByTimeAsync(600);
      await pending;
    });
  });

  it("espera que lança erro também é contabilizada", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = trackRateLimitWait(async () => {
        await sleep(500);
        throw new Error("redis down");
      });
      const assertion = expect(pending).rejects.toThrow("redis down");
      await jest.advanceTimersByTimeAsync(500);
      await assertion;
    });

    expect(rateLimitWaitMs(context)).toBe(500);
  });

  it("fora de job só executa, sem contexto", async () => {
    const pending = trackRateLimitWait(() => sleep(100).then(() => "ok"));
    await jest.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe("ok");
  });
});

describe("cancelamento do job (abortController do contexto)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sleepUnlessJobAborted acorda na hora e lança JobAbortedError quando o job é abortado no meio", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = sleepUnlessJobAborted(10_000);
      const assertion = expect(pending).rejects.toBeInstanceOf(JobAbortedError);
      await jest.advanceTimersByTimeAsync(100);
      context.abortController.abort(new Error("timeout"));
      await assertion;
    });
  });

  it("sleepUnlessJobAborted lança direto se o job já estava abortado", async () => {
    const context = createJobContext("LANE", 0);
    context.abortController.abort(new Error("timeout"));

    await jobContext.run(context, async () => {
      await expect(sleepUnlessJobAborted(1000)).rejects.toThrow("timeout");
    });
  });

  it("sleepUnlessJobAborted sem abort resolve normalmente", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      const pending = sleepUnlessJobAborted(1000);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBeUndefined();
    });
  });

  it("throwIfJobAborted só lança depois do abort, com o motivo do abort na mensagem", async () => {
    const context = createJobContext("LANE", 0);

    await jobContext.run(context, async () => {
      expect(() => throwIfJobAborted()).not.toThrow();
      context.abortController.abort(new Error("excedeu 120000ms"));
      expect(() => throwIfJobAborted()).toThrow(JobAbortedError);
      expect(() => throwIfJobAborted()).toThrow("excedeu 120000ms");
    });
  });

  it("fora de job: throwIfJobAborted não faz nada e o sleep é comum", async () => {
    expect(() => throwIfJobAborted()).not.toThrow();
    const pending = sleepUnlessJobAborted(500);
    await jest.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeUndefined();
  });
});
