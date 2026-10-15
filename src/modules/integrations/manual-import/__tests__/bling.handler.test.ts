// Handler Bling real com a API e os services de entidade mockados.
jest.mock("../../../handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  blingApi: {},
  getBlingIntegration: jest.fn(),
}));
jest.mock("../../../handlers/bling/services/bling/helpers/get-with-sleep", () => ({
  __esModule: true,
  blingGet: jest.fn(),
}));
jest.mock("../../../warehouse/fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock(
  "../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service",
  () => ({ __esModule: true, default: { findByIntegration: jest.fn() } }),
);
jest.mock("../helpers/product-mapping", () => ({
  __esModule: true,
  findProductLocalIds: jest.fn(),
  findProductExternalId: jest.fn(),
}));

import { Op } from "sequelize";
import { getBlingIntegration } from "../../../handlers/bling/api/bling_api.service";
import { blingGet } from "../../../handlers/bling/services/bling/helpers/get-with-sleep";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import integrationOrderStatusMappingService from "../../../sales/orders/integration-order-status-mapping/integration-order-status-mapping.service";
import { BlingManualImportHandler } from "../providers/bling.handler";

const INTEGRATION_ID = "bling-integration";
const notFound = () => Object.assign(new Error("404"), { response: { status: 404 } });

function paramsOf(call: any[]): Record<string, string> {
  return Object.fromEntries((call[2]?.params as URLSearchParams | undefined)?.entries() ?? []);
}

describe("BlingManualImportHandler", () => {
  let handler: BlingManualImportHandler;

  beforeEach(() => {
    handler = new BlingManualImportHandler();
    (getBlingIntegration as jest.Mock).mockResolvedValue({ id: INTEGRATION_ID });
  });

  describe("search invoice", () => {
    it("por id: nota anterior ao corte volta importable:false com o motivo", async () => {
      (blingGet as jest.Mock).mockResolvedValue({
        data: { data: { id: 77, numero: "123", tipo: 1, situacao: 5, dataEmissao: "2020-01-10 10:00:00" } },
      });

      const { items } = await handler.search("invoice", "id", "77");

      expect(blingGet).toHaveBeenCalledWith("/nfe/77", expect.anything());
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        externalId: "77",
        importable: false,
        reason: expect.stringContaining("anterior ao corte"),
        details: { model: "NF-e", type: "OUT", number: "123" },
      });
    });

    it("por id: NF-e de entrada volta importable:false (só nota de venda)", async () => {
      (blingGet as jest.Mock).mockResolvedValue({
        data: { data: { id: 78, numero: "50", tipo: 0, dataEmissao: "2026-09-01" } },
      });

      const { items } = await handler.search("invoice", "id", "78");

      expect(items[0]).toMatchObject({
        importable: false,
        reason: expect.stringContaining("nota de venda"),
        details: { type: "IN" },
      });
    });

    it("por id: 404 na /nfe não tenta /nfce — nenhum resultado", async () => {
      (blingGet as jest.Mock).mockRejectedValue(notFound());

      const { items } = await handler.search("invoice", "id", "99");

      expect(items).toEqual([]);
      expect(blingGet).toHaveBeenCalledTimes(1);
      expect(blingGet).toHaveBeenCalledWith("/nfe/99", expect.anything());
    });

    it("por número: só /nfe de saída (tipo=1), sem NFC-e", async () => {
      (blingGet as jest.Mock).mockResolvedValue({
        data: { data: [{ id: 2, numero: "500", situacao: 5, dataEmissao: "2026-09-01" }] },
      });

      const { items, truncated } = await handler.search("invoice", "number", "500");

      const calls = (blingGet as jest.Mock).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe("/nfe");
      expect(paramsOf(calls[0])).toMatchObject({ numero: "500", tipo: "1" });
      expect(items).toEqual([
        expect.objectContaining({
          externalId: "2",
          importable: true,
          details: expect.objectContaining({ model: "NF-e", type: "OUT" }),
          enqueueData: { number: "500", situacao: 5 },
        }),
      ]);
      expect(truncated).toBe(false);
    });
  });

  describe("search product/order", () => {
    it("produto por id usa idsProdutos[]; truncated quando a página vem cheia", async () => {
      const page = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, nome: `P${i}`, codigo: `C${i}` }));
      (blingGet as jest.Mock).mockResolvedValue({ data: { data: page } });

      const { items, truncated } = await handler.search("product", "name", "pneu");

      expect(paramsOf((blingGet as jest.Mock).mock.calls[0])).toMatchObject({ nome: "pneu", pagina: "1", limite: "100" });
      expect(items).toHaveLength(100);
      expect(truncated).toBe(true);

      (blingGet as jest.Mock).mockResolvedValue({ data: { data: [{ id: 5, nome: "P5" }] } });
      await handler.search("product", "id", "5");
      expect((blingGet as jest.Mock).mock.calls[1][2].params.getAll("idsProdutos[]")).toEqual(["5"]);
    });

    it("id não numérico: 400", async () => {
      await expect(handler.search("product", "id", "abc")).rejects.toMatchObject({
        httpStatus: 400,
        body: { code: "INVALID_SEARCH_VALUE" },
      });
    });

    it("pedido por número traduz a situação pelo mapeamento de status", async () => {
      (blingGet as jest.Mock).mockResolvedValue({
        data: { data: [{ id: 10, numero: 42, numeroLoja: "ML-1", data: "2026-10-01", contato: { nome: "Ana" }, situacao: { id: 6 } }] },
      });
      (integrationOrderStatusMappingService.findByIntegration as jest.Mock).mockResolvedValue([
        { external_status_id: "6", display_name: "Em aberto" },
      ]);

      const { items } = await handler.search("order", "number", "42");

      expect(items[0]).toMatchObject({
        externalId: "10",
        details: { number: "42", storeNumber: "ML-1", contact: "Ana", status: "Em aberto" },
      });
    });
  });

  describe("findLocalIds / findExternalIdByLocalId", () => {
    it("nota: uma consulta só com Op.in, escopada na integração", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([{ id: "local-2", id_system: "2" }]);

      const map = await handler.findLocalIds("invoice", ["1", "2"]);

      expect(invoiceService.findAll).toHaveBeenCalledWith({
        where: { integrations_id: INTEGRATION_ID, id_system: { [Op.in]: ["1", "2"] } },
        attributes: ["id", "id_system"],
      });
      expect(map).toEqual(new Map([["2", "local-2"]]));
    });

    it("nota local de outra integração: sem id externo", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue(null);

      expect(await handler.findExternalIdByLocalId("invoice", "local-1")).toBeNull();
      expect(invoiceService.findOne).toHaveBeenCalledWith({
        where: { id: "local-1", integrations_id: INTEGRATION_ID },
        attributes: ["id_system"],
      });
    });
  });

  describe("enqueue", () => {
    const jobOptions = {
      priority: 1,
      name: "manual-import",
      removeOnComplete: { age: 24 * 3600 },
    };

    function makeQueues() {
      return { blingApiFetch: { add: jest.fn() }, blingOrder: { add: jest.fn() } } as any;
    }

    it("produto: BLING_API_FETCH com prioridade 1 e retenção do job completo", async () => {
      const queues = makeQueues();

      await handler.enqueue(
        "product",
        { externalId: "5", label: "", importable: true, existsLocally: false, localId: null, enqueueData: null },
        { queue: "blingApiFetch", jobId: "job-5" },
        queues,
      );

      expect(queues.blingApiFetch.add).toHaveBeenCalledWith(
        expect.objectContaining({ resource: "product", apiFetch: expect.objectContaining({ blingId: 5 }) }),
        "job-5",
        jobOptions,
      );
    });

    it("nota: resource invoice (NF-e) com partialData e status mapeado da situação", async () => {
      const queues = makeQueues();

      await handler.enqueue(
        "invoice",
        {
          externalId: "7",
          label: "",
          importable: true,
          existsLocally: false,
          localId: null,
          enqueueData: { number: "9", situacao: 2 },
        },
        { queue: "blingApiFetch", jobId: "job-7" },
        queues,
      );

      expect(queues.blingApiFetch.add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "invoice",
          apiFetch: expect.objectContaining({
            partialData: { blingId: 7, number: "9", id_system: "7", status: "CANCELLED" },
          }),
        }),
        "job-7",
        jobOptions,
      );
    });

    it("pedido: order.updated na BLING_ORDER_INGESTION com prioridade 1", async () => {
      const queues = makeQueues();

      await handler.enqueue(
        "order",
        { externalId: "10", label: "", importable: true, existsLocally: true, localId: "o-1", enqueueData: null },
        { queue: "blingOrder", jobId: "job-10" },
        queues,
      );

      expect(queues.blingOrder.add).toHaveBeenCalledWith(
        { event: "order.updated", action: "updated", data: { id: 10 } },
        "job-10",
        jobOptions,
      );
    });
  });
});
