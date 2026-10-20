const pipelineSet = jest.fn();
jest.mock("../../../../../../shared/utils/base-models/base-redis", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    client: {
      mget: jest.fn(),
      pipeline: jest.fn(() => ({ set: pipelineSet, exec: jest.fn() })),
    },
  },
}));
jest.mock("../../../api/bling_api.service", () => ({
  getBlingIntegration: jest.fn(),
  blingApi: {},
}));
jest.mock("../../bling-sync/helpers/bling-list", () => ({
  ...jest.requireActual("../../bling-sync/helpers/bling-list"),
  paginateBling: jest.fn(),
  fetchBlingListPage: jest.fn(),
}));
jest.mock(
  "../../../../../warehouse/fiscal/invoices/invoice/invoice.service",
  () => ({ __esModule: true, default: { findAll: jest.fn() } }),
);
jest.mock("../../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import redisService from "../../../../../../shared/utils/base-models/base-redis";
import { getBlingIntegration } from "../../../api/bling_api.service";
import {
  fetchBlingListPage,
  paginateBling,
} from "../../bling-sync/helpers/bling-list";
import invoiceService from "../../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import ordersService from "../../../../../sales/orders/order/orders.service";
import { BlingPollService } from "../bling-poll.service";

// Chave da listagem simulada: endpoint + tipo + situacao (ex.: "/nfe:1:2").
const listingKey = (endpoint: string, query: Record<string, unknown>) =>
  `${endpoint}:${query.tipo ?? ""}:${query.situacao ?? ""}`;

// paginateBling simulado: uma página por listagem, nada quando não configurada.
function mockPages(pages: Record<string, any[]>) {
  (paginateBling as jest.Mock).mockImplementation(async function* (
    endpoint: string,
    query: Record<string, unknown>,
  ) {
    const items = pages[listingKey(endpoint, query)];
    if (items?.length) yield items;
  });
}

// fetchBlingListPage simulado (job de alterações, só a 1ª página).
function mockFirstPages(pages: Record<string, any[]>) {
  (fetchBlingListPage as jest.Mock).mockImplementation(
    async (endpoint: string, query: Record<string, unknown>) =>
      pages[listingKey(endpoint, query)] ?? [],
  );
}

describe("BlingPollService", () => {
  const apiFetch = { add: jest.fn(), hasPendingJobs: jest.fn(), hasPendingJobsExcept: jest.fn() };
  const orderIngestion = { add: jest.fn(), hasPendingJobs: jest.fn(), hasPendingJobsExcept: jest.fn() };
  let service: BlingPollService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlingPollService({ apiFetch, orderIngestion });
    (getBlingIntegration as jest.Mock).mockResolvedValue({ id: "integration-1" });
    (redisService.set as jest.Mock).mockResolvedValue("OK");
    (redisService.get as jest.Mock).mockResolvedValue(null);
    (redisService.delete as jest.Mock).mockResolvedValue(undefined);
    (redisService.client.mget as jest.Mock).mockResolvedValue([]);
    apiFetch.hasPendingJobs.mockResolvedValue(false);
    orderIngestion.hasPendingJobs.mockResolvedValue(false);
    apiFetch.hasPendingJobsExcept.mockResolvedValue(false);
    orderIngestion.hasPendingJobsExcept.mockResolvedValue(false);
    (invoiceService.findAll as jest.Mock).mockResolvedValue([]);
    (ordersService.findAll as jest.Mock).mockResolvedValue([]);
    mockPages({});
    mockFirstPages({});
  });

  describe("pollNewRecords", () => {
    it("enfileira só NF-e (saída, cancelada, entrada) e pedidos que não existem no banco", async () => {
      mockPages({
        "/nfe:1:": [{ id: 10, numero: "100", situacao: 5 }, { id: 11, situacao: 5 }],
        "/nfe:1:2": [{ id: 12, situacao: 2 }],
        "/nfe:0:": [{ id: 13, situacao: 7 }],
        "/pedidos/vendas::": [{ id: 30, numero: 300 }, { id: 31 }],
      });
      (invoiceService.findAll as jest.Mock).mockImplementation(async ({ where }) => {
        const ids: string[] =
          where.id_system[Object.getOwnPropertySymbols(where.id_system)[0]];
        return ids.includes("11") ? [{ id_system: "11" }] : [];
      });
      (ordersService.findAll as jest.Mock).mockResolvedValue([{ id_order_system: "31" }]);

      await service.pollNewRecords();

      expect(apiFetch.add.mock.calls.map(([, jobId]) => jobId).sort()).toEqual([
        "bling-poll-invoice-fetch-10",
        "bling-poll-invoice-fetch-12",
        "bling-poll-invoice-fetch-13",
      ]);
      const cancelled = apiFetch.add.mock.calls.find(([, id]) => id.endsWith("-12"))![0];
      expect(cancelled.apiFetch.partialData.status).toBe("CANCELLED");
      // NFC-e saiu do poll.
      expect((paginateBling as jest.Mock).mock.calls.map(([e]) => e)).not.toContain("/nfce");
      // Filtro de emissão com hora: só data não filtra o dia corrente na Bling.
      const nfeQuery = (paginateBling as jest.Mock).mock.calls.find(([e]) => e === "/nfe")![1];
      expect(nfeQuery.dataEmissaoInicial).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);

      // Criação sem options: prioridade padrão (de webhook) de cada fila.
      expect(apiFetch.add.mock.calls.every((call) => call.length === 2)).toBe(true);
      expect(orderIngestion.add).toHaveBeenCalledTimes(1);
      expect(orderIngestion.add).toHaveBeenCalledWith(
        expect.objectContaining({ event: "order.created", data: expect.objectContaining({ id: 30 }) }),
        "bling-order-created-30",
      );
      // Situação de criação gravada com NX pro job de alterações.
      expect(pipelineSet).toHaveBeenCalledWith(
        "bling-poll:invoice-situacao:10", "5", "EX", expect.any(Number), "NX",
      );
    });

    it("roda com só jobs de atualização pendentes (criação fura a fila)", async () => {
      mockPages({ "/pedidos/vendas::": [{ id: 30 }] });
      apiFetch.hasPendingJobs.mockResolvedValue(true);
      orderIngestion.hasPendingJobs.mockResolvedValue(true);

      await service.pollNewRecords();

      expect(apiFetch.hasPendingJobsExcept).toHaveBeenCalledWith(["bling-poll-update"]);
      expect(orderIngestion.add).toHaveBeenCalledWith(expect.anything(), "bling-order-created-30");
    });

    it("não reenfileira registro com marca ainda válida no Redis", async () => {
      mockPages({ "/pedidos/vendas::": [{ id: 30 }] });
      (redisService.set as jest.Mock).mockResolvedValue(null);

      await service.pollNewRecords();

      expect(orderIngestion.add).not.toHaveBeenCalled();
    });

    it("apaga a marca e falha a rodada quando o add na fila falha", async () => {
      mockPages({ "/pedidos/vendas::": [{ id: 30 }] });
      orderIngestion.add.mockRejectedValueOnce(new Error("redis down"));

      await expect(service.pollNewRecords()).rejects.toThrow("redis down");
      expect(redisService.delete).toHaveBeenCalledWith("bling-poll:enqueued:order:30");
    });
  });

  describe("pollRecentChanges", () => {
    it("refaz o fetch só das NF-e com situação nova e enfileira os pedidos alterados", async () => {
      mockFirstPages({
        "/nfe:1:": [{ id: 10, situacao: 5 }, { id: 11, situacao: 5 }],
        "/nfe:1:2": [{ id: 12, situacao: 2 }],
        "/nfe:0:": [],
        "/pedidos/vendas::": [{ id: 30 }, { id: 31 }],
      });
      // 10 sem mudança, 11 nunca vista, 12 era autorizada e foi cancelada.
      (redisService.client.mget as jest.Mock).mockResolvedValue(["5", null, "5"]);

      await service.pollRecentChanges();

      expect(apiFetch.add.mock.calls.map(([, jobId]) => jobId)).toEqual([
        "bling-poll-invoice-refetch-11-5",
        "bling-poll-invoice-refetch-12-2",
      ]);
      // Atualização vai pro fim da fila, com nome próprio.
      const updateOptions = { priority: 10, name: "bling-poll-update" };
      expect(apiFetch.add.mock.calls.every(([, , opts]) => opts?.priority === 10 && opts?.name === "bling-poll-update")).toBe(true);
      expect(orderIngestion.add.mock.calls.every(([, , opts]) => JSON.stringify(opts) === JSON.stringify(updateOptions))).toBe(true);
      expect(pipelineSet).toHaveBeenCalledWith(
        "bling-poll:invoice-situacao:12", "2", "EX", expect.any(Number),
      );
      expect((fetchBlingListPage as jest.Mock).mock.calls.every(([, , , size]) => size === 50)).toBe(true);

      const ordersQuery = (fetchBlingListPage as jest.Mock).mock.calls.find(
        ([e]) => e === "/pedidos/vendas",
      )![1];
      expect(ordersQuery.dataAlteracaoInicial).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(orderIngestion.add.mock.calls.map(([data, jobId]) => [data.event, jobId])).toEqual([
        ["order.updated", "bling-order-updated-30"],
        ["order.updated", "bling-order-updated-31"],
      ]);
      expect(redisService.set).toHaveBeenCalledWith(
        "bling-poll:orders-changed-cursor", expect.any(String), expect.any(Object),
      );
    });

    it("espera as filas esvaziarem, inclusive de jobs de atualização anteriores", async () => {
      apiFetch.hasPendingJobs.mockResolvedValue(true);

      await service.pollRecentChanges();

      expect(fetchBlingListPage).not.toHaveBeenCalled();
      expect(apiFetch.add).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["BLING_API_FETCH", apiFetch],
    ["BLING_ORDER_INGESTION", orderIngestion],
  ])("nenhum dos jobs consulta a Bling enquanto %s tem job (não-atualização) pendente", async (_name, busy) => {
    busy.hasPendingJobs.mockResolvedValue(true);
    busy.hasPendingJobsExcept.mockResolvedValue(true);

    await service.pollNewRecords();
    await service.pollRecentChanges();

    expect(paginateBling).not.toHaveBeenCalled();
    expect(fetchBlingListPage).not.toHaveBeenCalled();
    expect(apiFetch.add).not.toHaveBeenCalled();
    expect(orderIngestion.add).not.toHaveBeenCalled();
  });
});
