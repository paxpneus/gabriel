// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
    scan: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

jest.mock("../../../api/bling_api.service", () => ({
  getBlingIntegration: jest.fn().mockResolvedValue({ id: "int-bling", name: "Bling" }),
  blingApi: {},
}));
jest.mock("../../bling/helpers/payment-method", () => ({
  resolveBlingPaymentMethods: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock("../helpers/bling-list", () => ({
  ...jest.requireActual("../helpers/bling-list"),
  paginateBling: jest.fn(),
}));

import { BlingSyncService } from "../bling-sync.service";
import { paginateBling } from "../helpers/bling-list";
import { resolveBlingPaymentMethods } from "../../bling/helpers/payment-method";

// Páginas como a lista /formas-pagamentos da Bling devolve (sem condicao/dadosCartao).
function pages(...lists: any[][]) {
  (paginateBling as jest.Mock).mockImplementation(async function* () {
    for (const list of lists) yield list;
  });
}

const form = (id: number, tipoPagamento?: number, descricao = "") => ({ id, tipoPagamento, descricao });

describe("BlingSyncService — etapa payment_methods", () => {
  const service = new BlingSyncService();

  beforeEach(() => jest.clearAllMocks());

  it("resolveSteps: payment_methods vem antes de produtos/notas/pedidos", () => {
    const steps = (service as any).resolveSteps({
      entities: ["orders", "products", "payment_methods"],
    });
    expect(steps[0]).toBe("payment_methods");
    expect(steps).toEqual(["payment_methods", "products", "orders"]);
  });

  it("pagina /formas-pagamentos e resolve cada página com o tipo e o nome, sem parcelas/bandeira (undefined = mantém)", async () => {
    pages([form(1, 3, "Crédito Visa 1x"), form(2, 15, "Boleto")], [form(3, undefined, "")]);

    const result = await (service as any).populatePaymentMethods(null);

    expect(paginateBling).toHaveBeenCalledWith("/formas-pagamentos");
    expect(resolveBlingPaymentMethods).toHaveBeenCalledTimes(2);
    expect((resolveBlingPaymentMethods as jest.Mock).mock.calls[0]).toEqual([
      [
        { id: 1, type: 3, description: "Crédito Visa 1x" },
        { id: 2, type: 15, description: "Boleto" },
      ],
      "int-bling",
    ]);
    // sem tipo → null; descrição vazia → null
    expect((resolveBlingPaymentMethods as jest.Mock).mock.calls[1][0]).toEqual([
      { id: 3, type: null, description: null },
    ]);
    expect(result).toEqual({ step: "payment_methods", enqueued: 3, skipped: 0 });
  });

  it("limit corta no meio da página e para de paginar", async () => {
    pages([form(1, 3), form(2, 3), form(3, 3)], [form(4, 3)]);

    const result = await (service as any).populatePaymentMethods(2);

    expect(resolveBlingPaymentMethods).toHaveBeenCalledTimes(1);
    expect((resolveBlingPaymentMethods as jest.Mock).mock.calls[0][0]).toHaveLength(2);
    expect(result.enqueued).toBe(2);
  });

  it("erro do helper (ex.: sem 'Outros' no catálogo) derruba a etapa", async () => {
    pages([form(1, 5)]);
    (resolveBlingPaymentMethods as jest.Mock).mockRejectedValueOnce(new Error('Forma de pagamento "Outros" não cadastrada'));
    await expect((service as any).populatePaymentMethods(null)).rejects.toThrow(/Outros/);
  });
});
