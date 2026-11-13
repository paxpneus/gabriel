// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../../../config/redis", () => ({
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

jest.mock("../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb: any) => cb({})),
    literal: jest.fn((value: string) => value),
  },
}));

jest.mock("../repositories/ingestion.repository", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findById: jest.fn(),
    findUnitBusinessesByCnpj: jest.fn(),
    findInvoiceAttribute: jest.fn(),
    createInvoiceAttributes: jest.fn(),
    findAll: jest.fn(),
    updateWithAttributes: jest.fn(),
  },
}));

jest.mock("../../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import mockedRepository from "../repositories/ingestion.repository";
import invoiceIngestionService from "../services/ingestion.service";
import storeService from "../../../../../../sales/stores/stores.service";

const repo = mockedRepository as unknown as {
  create: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("InvoiceIngestionService.createStub", () => {
  it("preenche só os campos conhecidos, usa a loja 'Outros' como placeholder e nunca referencia outra model direto no service (só storeService)", async () => {
    (storeService.findOne as jest.Mock).mockResolvedValue({ id: "store-outros" });
    repo.create.mockResolvedValue({ id: "invoice-stub-1" });

    const result = await invoiceIngestionService.createStub({
      id: "invoice-stub-1",
      integrationsId: "tecinco-1",
      numberSystem: "020309",
      idSystem: "chave-44",
      xmlKey: "chave-44",
      danfePath: "temp://temp-1",
      senderCnpj: "02316749002383",
      senderName: "Loja Origem",
    });

    expect(storeService.findOne).toHaveBeenCalledWith({
      where: { name: "Outros" },
    });
    expect(repo.create).toHaveBeenCalledWith(
      {
        id: "invoice-stub-1",
        integrations_id: "tecinco-1",
        number_system: "020309",
        id_system: "chave-44",
        xml_key: "chave-44",
        danfe_path: "temp://temp-1",
        store_id: "store-outros",
        customer_name: "Loja Origem",
        customer_document: "02316749002383",
        sender_cnpj: "02316749002383",
        sender_name: "Loja Origem",
        receiver_cnpj: "",
        receiver_name: "",
      },
      undefined,
    );
    expect(result).toEqual({ id: "invoice-stub-1" });
  });

  it("sem dado nenhum de emitente (ex.: stub Bling antes do fetch resolver) — cai tudo pra string vazia, nunca null/undefined nas colunas NOT NULL", async () => {
    (storeService.findOne as jest.Mock).mockResolvedValue({ id: "store-outros" });
    repo.create.mockResolvedValue({ id: "invoice-stub-2" });

    await invoiceIngestionService.createStub({
      integrationsId: "bling-1",
      numberSystem: "16603",
      idSystem: "26587010552",
      danfePath: "https://bling.com.br/danfe/16603.pdf",
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: "",
        customer_document: "",
        sender_cnpj: "",
        sender_name: "",
        receiver_cnpj: "",
        receiver_name: "",
      }),
      undefined,
    );
  });

  it("loja 'Outros' não cadastrada — recusa com erro claro em vez de gravar store_id inválido", async () => {
    (storeService.findOne as jest.Mock).mockResolvedValue(null);

    await expect(
      invoiceIngestionService.createStub({
        integrationsId: "tecinco-1",
        numberSystem: "020309",
      }),
    ).rejects.toThrow(/Loja padrão "Outros" não cadastrada/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
