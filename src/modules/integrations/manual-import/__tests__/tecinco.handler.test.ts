// Handler Tecinco real com a API e os services de entidade mockados.
const mockListarProdutos = jest.fn();
const mockGetNotaFiscal = jest.fn();

jest.mock("../../../handlers/tecinco/api/tecinco_api", () => ({
  __esModule: true,
  getTCarIntegration: jest.fn(),
}));
jest.mock("../../../handlers/tecinco/service/produtos/produtos.service", () => ({
  __esModule: true,
  TCarProdutoService: jest.fn().mockImplementation(() => ({
    listarProdutos: mockListarProdutos,
  })),
}));
jest.mock(
  "../../../handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service",
  () => ({
    __esModule: true,
    TCarConferenciaEstoqueService: jest.fn().mockImplementation(() => ({
      getNotaFiscal: mockGetNotaFiscal,
    })),
  }),
);
jest.mock("../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../warehouse/fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../helpers/product-mapping", () => ({
  __esModule: true,
  findProductLocalIds: jest.fn(),
  findProductExternalId: jest.fn(),
}));

import { getTCarIntegration } from "../../../handlers/tecinco/api/tecinco_api";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { parseAccessKey } from "../../../../shared/utils/xml/access-key";
import { TecincoManualImportHandler } from "../providers/tecinco.handler";

// cUF 41 · AAMM 2610 · CNPJ 12345678000190 · mod 55 · série 001 · nNF 000004321 · tpEmis 1 · cNF 12345678 · DV 9
const ACCESS_KEY = "41261012345678000190550010000043211123456789";
const notFound = () => Object.assign(new Error("404"), { response: { status: 404 } });

describe("parseAccessKey", () => {
  it("extrai número, série, modelo e CNPJ do emitente", () => {
    expect(parseAccessKey(ACCESS_KEY)).toEqual({
      emitterCnpj: "12345678000190",
      model: "55",
      series: "1",
      number: "4321",
    });
  });

  it("chave sem 44 dígitos: null", () => {
    expect(parseAccessKey("123")).toBeNull();
  });
});

describe("TecincoManualImportHandler", () => {
  let handler: TecincoManualImportHandler;

  beforeEach(() => {
    handler = new TecincoManualImportHandler();
    (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-integration" });
  });

  describe("search invoice por chave", () => {
    it("número/CNPJ saem da chave; filial = UnitBusiness Tecinco do emitente", async () => {
      (unitBusinessService.findOne as jest.Mock).mockResolvedValue({ number: "17" });
      mockGetNotaFiscal.mockResolvedValue({
        data: {
          cabecalho: { entrada_saida: "S", situacao: "A" },
          cliente: { nome: "CLIENTE SA" },
        },
      });

      const { items } = await handler.search("invoice", "access_key", ACCESS_KEY);

      expect(unitBusinessService.findOne).toHaveBeenCalledWith({
        where: { cnpj: "12345678000190" },
        attributes: ["number"],
      });
      expect(mockGetNotaFiscal).toHaveBeenCalledTimes(1);
      expect(mockGetNotaFiscal).toHaveBeenCalledWith("4321", 17, { chave_nfe: ACCESS_KEY });
      expect(items).toEqual([
        expect.objectContaining({
          externalId: ACCESS_KEY,
          details: expect.objectContaining({
            number: "4321",
            series: "1",
            model: "NF-e",
            type: "OUT",
            contact: "CLIENTE SA",
            status: "A",
          }),
          enqueueData: { numero: "4321", chaveAcesso: ACCESS_KEY, branchId: 17 },
        }),
      ]);
    });

    it("emitente fora das filiais Tecinco (nota de entrada): tenta todas e fica com a que respondeu", async () => {
      (unitBusinessService.findOne as jest.Mock).mockResolvedValue(null);
      mockGetNotaFiscal.mockImplementation(async (_numero: string, branchId: number) => {
        if (branchId === 12) throw notFound();
        return { data: { cabecalho: { entrada_saida: "E" } } };
      });

      const { items } = await handler.search("invoice", "access_key", ACCESS_KEY);

      expect(mockGetNotaFiscal).toHaveBeenCalledTimes(2);
      expect(items[0]).toMatchObject({
        details: { type: "IN" },
        enqueueData: { branchId: 17 },
      });
    });

    it("404 em todas as filiais: nenhum resultado", async () => {
      (unitBusinessService.findOne as jest.Mock).mockResolvedValue(null);
      mockGetNotaFiscal.mockRejectedValue(notFound());

      const { items } = await handler.search("invoice", "access_key", ACCESS_KEY);

      expect(items).toEqual([]);
    });

    it("chave inválida: 400", async () => {
      await expect(handler.search("invoice", "access_key", "123")).rejects.toMatchObject({
        httpStatus: 400,
        body: { code: "INVALID_SEARCH_VALUE" },
      });
    });
  });

  describe("search product", () => {
    it("por id usa codigo_integracao com filiais; só uma chamada à Tecinco, sem índice de duplicidade", async () => {
      const product = { epctb_codigo: "900", epctb_nome: "PNEU X", epctb_codigofabrica: "ABC", epctb_ean: "789" };
      mockListarProdutos.mockResolvedValue({ data: [product] });

      const { items, truncated } = await handler.search("product", "id", "900");

      expect(mockListarProdutos).toHaveBeenCalledTimes(1);
      expect(mockListarProdutos).toHaveBeenCalledWith(12, {
        codigo_integracao: "900",
        include: "filiais",
        branch_ids: "12,17",
        limit: 100,
        offset: 0,
      });
      expect(truncated).toBe(false);
      expect(items[0]).toMatchObject({
        externalId: "900",
        details: { name: "PNEU X", code: "ABC", ean: "789" },
        enqueueData: { payload: product },
      });
    });

    it("por nome: filtra por nome e devolve vazio quando não acha", async () => {
      mockListarProdutos.mockResolvedValue({ data: [] });

      const { items } = await handler.search("product", "name", "nada");

      expect(mockListarProdutos).toHaveBeenCalledWith(12, expect.objectContaining({ nome: "nada" }));
      expect(items).toEqual([]);
    });
  });

  describe("enqueue", () => {
    const jobOptions = {
      priority: 1,
      name: "manual-import",
      removeOnComplete: { age: 24 * 3600 },
    };

    it("nota: resource invoice_by_key na TCAR_INVOICE com a filial da busca", async () => {
      const queues = { tcarInvoice: { add: jest.fn() }, tcarApiFetch: { add: jest.fn() } } as any;

      await handler.enqueue(
        "invoice",
        {
          externalId: ACCESS_KEY,
          label: "",
          importable: true,
          existsLocally: false,
          localId: null,
          enqueueData: { numero: "4321", chaveAcesso: ACCESS_KEY, branchId: 17 },
        },
        { queue: "tcarInvoice", jobId: "job-1" },
        queues,
      );

      expect(queues.tcarInvoice.add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "invoice_by_key",
          branchId: 17,
          data: { numero: "4321", chaveAcesso: ACCESS_KEY },
        }),
        "job-1",
        jobOptions,
      );
    });

    it("produto: payload guardado na busca na TCAR_API_FETCH, com as flags de duplicidade calculadas no worker", async () => {
      const queues = { tcarInvoice: { add: jest.fn() }, tcarApiFetch: { add: jest.fn() } } as any;
      const payload = { epctb_codigo: "900", epctb_nome: "PNEU X" };

      await handler.enqueue(
        "product",
        {
          externalId: "900",
          label: "",
          importable: true,
          existsLocally: false,
          localId: null,
          enqueueData: { payload },
        },
        { queue: "tcarApiFetch", jobId: "job-2" },
        queues,
      );

      expect(queues.tcarApiFetch.add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "product",
          data: payload,
          detectCatalogDuplicates: true,
        }),
        "job-2",
        jobOptions,
      );
    });
  });
});
