// ─── Mocks de infraestrutura (Redis) e dependências transitivas de
// bling_api.service.ts — este é o primeiro teste a importar o módulo real
// (os outros sempre mockam "bling_api.service" inteiro), então tudo que ele
// puxa em cadeia (integrations.service, config_tokens.model, config/axios,
// alertService) precisa de um stub mínimo pra não tocar Sequelize/SMTP reais.
jest.mock("../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: {
    eval: jest.fn(),
    getset: jest.fn().mockResolvedValue(null),
    pexpire: jest.fn().mockResolvedValue(1),
  },
}));

jest.mock("../../../../integrations/integrations/integrations.service", () => ({
  __esModule: true,
  default: { getFullIntegration: jest.fn() },
}));

jest.mock("../../../../integrations/config_tokens/config_tokens.model", () => ({
  __esModule: true,
  default: class {},
}));

jest.mock("../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

jest.mock("../../../../../config/axios", () => ({
  __esModule: true,
  createAxiosInstance: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
  })),
}));

import { redisClient } from "../../../../../config/redis";
import { waitForBlingRateLimit } from "../bling_api.service";

// TRY_DISPATCH_SCRIPT é a única das duas Lua scripts usadas aqui que
// referencia "nextAllowed" — usado pra distinguir, no mock genérico de
// `eval`, a chamada que decide liberar/negar o disparo da chamada (separada)
// que só incrementa o contador diagnóstico — senão as duas competiriam pela
// mesma fila de retornos programados e o teste contaria errado.
function isDispatchScript(script: unknown): boolean {
  return typeof script === "string" && script.includes("nextAllowed");
}

function queueDispatchDecisions(...waitMsSequence: number[]): void {
  const queue = [...waitMsSequence];
  (redisClient.eval as jest.Mock).mockImplementation((script: string) => {
    if (isDispatchScript(script)) {
      return Promise.resolve(queue.length > 0 ? queue.shift() : 0);
    }
    return Promise.resolve(1); // chamada do contador diagnóstico — irrelevante aqui
  });
}

function dispatchScriptCallCount(): number {
  return (redisClient.eval as jest.Mock).mock.calls.filter(([script]) =>
    isDispatchScript(script),
  ).length;
}

describe("waitForBlingRateLimit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sem contenção (script libera de cara): resolve sem dormir, consultando o Redis uma única vez", async () => {
    queueDispatchDecisions(0);

    await waitForBlingRateLimit();

    expect(dispatchScriptCallCount()).toBe(1);
  });

  it("negado uma vez: dorme exatamente o tempo indicado e RECONFERE no Redis antes de disparar — nunca dispara só porque o timer venceu", async () => {
    queueDispatchDecisions(1500, 0);

    let resolved = false;
    const pending = waitForBlingRateLimit().then(() => {
      resolved = true;
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(false);
    expect(dispatchScriptCallCount()).toBe(1); // ainda não reconferiu

    await jest.advanceTimersByTimeAsync(500);
    await pending;

    expect(resolved).toBe(true);
    expect(dispatchScriptCallCount()).toBe(2); // reconferiu, e só então disparou
  });

  it("negado várias vezes seguidas (simula várias chamadas concorrentes perdendo a checagem): cada negação gera uma nova consulta atômica, nunca um disparo cego", async () => {
    queueDispatchDecisions(800, 400, 200, 0);

    let resolved = false;
    const pending = waitForBlingRateLimit().then(() => {
      resolved = true;
    });

    await jest.advanceTimersByTimeAsync(800);
    expect(dispatchScriptCallCount()).toBe(2);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(400);
    expect(dispatchScriptCallCount()).toBe(3);
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(200);
    await pending;

    expect(dispatchScriptCallCount()).toBe(4);
    expect(resolved).toBe(true);
  });

  it("várias chamadas concorrentes: cada uma reconfere de forma independente, e todas eventualmente resolvem", async () => {
    // Cada chamada concorrente consulta o script; como o mock não modela o
    // estado real do Redis entre chamadas (isso é coberto pelo próprio
    // script Lua, testado por leitura de código/produção), aqui o que
    // importa é que N chamadas concorrentes geram N fluxos de retry
    // independentes que todos resolvem corretamente, sem uma travar a outra.
    queueDispatchDecisions(0, 500, 0, 1000, 500, 0);

    const results = await Promise.allSettled([
      waitForBlingRateLimit(),
      (async () => {
        const p = waitForBlingRateLimit();
        await jest.advanceTimersByTimeAsync(500);
        await p;
      })(),
      (async () => {
        const p = waitForBlingRateLimit();
        await jest.advanceTimersByTimeAsync(1500);
        await p;
      })(),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
