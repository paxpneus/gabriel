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
  resolveBlingPaymentMethods: jest.fn(),
}));

import { AxiosInstance } from "axios";
import { BlingOrderService } from "../bling-order.service";
import { resolveBlingPaymentMethods } from "../../bling/helpers/payment-method";

// /formas-pagamentos/{id} da Bling por id (detalhe traz condicao/dadosCartao).
const FORMS: Record<string, any> = {
  "9521718": { descricao: "Rede - Crédito Master 2x", tipoPagamento: 3, condicao: "2x", dadosCartao: { bandeira: 2 } },
  "9521738": { descricao: "Rede - Crédito Master 3x", tipoPagamento: 3, condicao: "3X", dadosCartao: { bandeira: 2 } },
  "6240158": { descricao: "Boleto", tipoPagamento: 15, condicao: "30 60 90" },
  "6240159": { descricao: "Crédito Visa 1x", tipoPagamento: 3, condicao: "30/60", dadosCartao: { bandeira: 1 } },
  "7837371": { descricao: "Pix", tipoPagamento: 17, condicao: "" },
  "8104554": { descricao: "Devolução de mercadorias", tipoPagamento: 5, condicao: "entrada + 2" },
  "5352299": { descricao: "Dinheiro", tipoPagamento: 1, condicao: "0", dadosCartao: { bandeira: 0 } },
  "1": { descricao: "", tipoPagamento: 1 },
};

function fakeApi(): { api: AxiosInstance; get: jest.Mock } {
  const get = jest.fn(async (url: string) => {
    const id = url.replace("/formas-pagamentos/", "");
    return { data: { data: { id: Number(id), ...FORMS[id] } } };
  });
  // Escrita nunca é chamada nesses fluxos: qualquer uma falha o teste.
  const fail = jest.fn(() => {
    throw new Error("escrita na Bling não permitida no teste");
  });
  return { api: { get, post: fail, put: fail, patch: fail, delete: fail } as any, get };
}

const parcela = (id: number, formId: number | null, valor: number, dataVencimento = "2026-12-07") => ({
  id,
  valor,
  dataVencimento,
  observacoes: "",
  formaPagamento: formId === null ? undefined : { id: formId },
});

describe("BlingOrderService.resolveOrderPayments — formas, parcelas e bandeira", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveBlingPaymentMethods as jest.Mock).mockImplementation(async (forms: any[]) => {
      return new Map(forms.map((form) => [String(form.id), `pm-${form.type}`]));
    });
  });

  it("pedido 2x + 3x Master (5 parcelas): uma linha por parcela com installments/card_brand da forma", async () => {
    const { api } = fakeApi();
    const service = new BlingOrderService(api);

    const rows = await (service as any).resolveOrderPayments([
      parcela(1, 9521718, 844.11),
      parcela(2, 9521738, 456.36),
      parcela(3, 9521718, 844.11, "2027-01-05"),
      parcela(4, 9521738, 456.36, "2027-01-05"),
      parcela(5, 9521738, 456.38, "2027-02-03"),
    ]);

    expect(rows).toHaveLength(5);
    expect(rows.filter((r: any) => r.installments === 2)).toHaveLength(2);
    expect(rows.filter((r: any) => r.installments === 3)).toHaveLength(3);
    expect(rows[0]).toEqual({
      payment_method_id: "pm-3",
      form_description: "Rede - Crédito Master 2x",
      installments: 2,
      card_brand: 2,
      id_system: "1",
      amount: 844.11,
      due_date: "2026-12-07",
      notes: null,
    });
    // helper recebe cada forma uma vez, com o detalhe (parcelas/bandeira) pro erp_data
    const [forms, integrationId] = (resolveBlingPaymentMethods as jest.Mock).mock.calls[0];
    expect(integrationId).toBe("int-bling");
    expect(forms).toEqual([
      { id: "9521718", type: 3, description: "Rede - Crédito Master 2x", installments: 2, cardBrand: 2 },
      { id: "9521738", type: 3, description: "Rede - Crédito Master 3x", installments: 3, cardBrand: 2 },
    ]);
  });

  it("condicao: '2x'/'3X' → N, dias '30 60 90'/'30/60' → contagem, vazio/'0' → 1, formato desconhecido → null; bandeira 0/ausente → null", async () => {
    const { api } = fakeApi();
    const service = new BlingOrderService(api);

    const rows = await (service as any).resolveOrderPayments([
      parcela(1, 6240158, 10),
      parcela(2, 6240159, 10),
      parcela(3, 7837371, 10),
      parcela(4, 8104554, 10),
      parcela(5, 5352299, 10),
      parcela(6, 1, 10),
    ]);

    const byForm = Object.fromEntries(rows.map((r: any) => [r.id_system, [r.installments, r.card_brand]]));
    expect(byForm).toEqual({
      "1": [3, null], // Boleto 30 60 90
      "2": [2, 1], // 30/60, Visa
      "3": [1, null], // Pix, condicao vazia
      "4": [null, null], // "entrada + 2": não chuta
      "5": [1, null], // "0" e bandeira 0
      "6": [1, null], // sem condicao, descricao vazia
    });
    expect(rows.find((r: any) => r.id_system === "6").form_description).toBeNull();
  });

  it("cache por forma: segunda importação da mesma forma não bate de novo na Bling", async () => {
    const { api, get } = fakeApi();
    const service = new BlingOrderService(api);
    // forma ainda não vista nesse processo (cache é por módulo)
    FORMS["4242"] = { descricao: "Crédito Elo 4x", tipoPagamento: 3, condicao: "4x", dadosCartao: { bandeira: 6 } };

    await (service as any).resolveOrderPayments([parcela(1, 4242, 10)]);
    await (service as any).resolveOrderPayments([parcela(2, 4242, 10)]);

    expect(get.mock.calls.filter(([url]) => url === "/formas-pagamentos/4242")).toHaveLength(1);
  });

  it("sem parcelas ou parcela sem forma: não chama Bling nem o helper", async () => {
    const { api, get } = fakeApi();
    const service = new BlingOrderService(api);

    expect(await (service as any).resolveOrderPayments(undefined)).toEqual([]);
    expect(await (service as any).resolveOrderPayments([parcela(1, null, 10)])).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(resolveBlingPaymentMethods).not.toHaveBeenCalled();
  });

  it("vencimento '0000-00-00' vira null", async () => {
    const { api } = fakeApi();
    const service = new BlingOrderService(api);
    const [row] = await (service as any).resolveOrderPayments([parcela(1, 7837371, 10, "0000-00-00")]);
    expect(row.due_date).toBeNull();
  });
});
