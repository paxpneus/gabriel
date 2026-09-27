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

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb: any) => cb({})),
    literal: jest.fn((value: string) => value),
  },
}));

jest.mock("../invoice.repository", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findById: jest.fn(),
    findUnitBusinessesByCnpj: jest.fn(),
    findInvoiceAttribute: jest.fn(),
    createInvoiceAttributes: jest.fn(),
  },
}));

jest.mock("../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../../../../../handlers/temp-file/temp-file.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../../../handlers/uploader/services/uploader.service", () => ({
  __esModule: true,
  default: { getFile: jest.fn() },
}));

import mockedRepository from "../invoice.repository";
import invoiceService from "../invoice.service";
import storeService from "../../../../../sales/stores/stores.service";
import tempFileService from "../../../../../handlers/temp-file/temp-file.service";
import uploaderService from "../../../../../handlers/uploader/services/uploader.service";
import { buildTempFileSentinelPath } from "../../../../../handlers/temp-file/temp-file.constants";

const repo = mockedRepository as unknown as {
  create: jest.Mock;
  findById: jest.Mock;
  findUnitBusinessesByCnpj: jest.Mock;
  findInvoiceAttribute: jest.Mock;
  createInvoiceAttributes: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("InvoiceService.createStub", () => {
  it("preenche só os campos conhecidos, usa a loja 'Outros' como placeholder e nunca referencia outra model direto no service (só storeService)", async () => {
    (storeService.findOne as jest.Mock).mockResolvedValue({ id: "store-outros" });
    repo.create.mockResolvedValue({ id: "invoice-stub-1" });

    const result = await invoiceService.createStub({
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

    await invoiceService.createStub({
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
      invoiceService.createStub({
        integrationsId: "tecinco-1",
        numberSystem: "020309",
      }),
    ).rejects.toThrow(/Loja padrão "Outros" não cadastrada/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("InvoiceService.getDanfeBuffer", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("danfe_path externo (ex.: linkPDF da Bling) — busca direto por HTTP, nunca via uploaderService (evita vazar a credencial do storage interno pro host externo)", async () => {
    repo.findById.mockResolvedValue({
      id: "invoice-1",
      danfe_path: "https://bling.com.br/danfe/16603.pdf",
    });
    const arrayBuffer = new TextEncoder().encode("pdf-bytes").buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    }) as any;

    const buffer = await invoiceService.getDanfeBuffer("invoice-1");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://bling.com.br/danfe/16603.pdf",
    );
    expect(uploaderService.getFile).not.toHaveBeenCalled();
    expect(buffer.toString()).toBe("pdf-bytes");
  });

  it("danfe_path externo mas a resposta HTTP falha — erro claro em vez de repassar um buffer vazio/corrompido", async () => {
    repo.findById.mockResolvedValue({
      id: "invoice-1",
      danfe_path: "https://bling.com.br/danfe/16603.pdf",
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

    await expect(invoiceService.getDanfeBuffer("invoice-1")).rejects.toThrow(
      /Falha ao baixar DANFE externo: 404/,
    );
  });

  it("danfe_path sentinela (upload em staging, vínculo rápido de nota de transferência) — lê o buffer direto de temp_files", async () => {
    const sentinelPath = buildTempFileSentinelPath("temp-1");
    repo.findById.mockResolvedValue({ id: "invoice-1", danfe_path: sentinelPath });
    (tempFileService.findById as jest.Mock).mockResolvedValue({
      id: "temp-1",
      buffer: Buffer.from("staged-pdf"),
    });

    const buffer = await invoiceService.getDanfeBuffer("invoice-1");

    expect(tempFileService.findById).toHaveBeenCalledWith("temp-1", {
      attributes: ["id", "buffer"],
    });
    expect(uploaderService.getFile).not.toHaveBeenCalled();
    expect(buffer.toString()).toBe("staged-pdf");
  });

  it("danfe_path sentinela mas o upload já terminou entre a primeira leitura e agora (corrida) — recarrega e serve via uploaderService", async () => {
    const sentinelPath = buildTempFileSentinelPath("temp-1");
    repo.findById
      .mockResolvedValueOnce({ id: "invoice-1", danfe_path: sentinelPath })
      .mockResolvedValueOnce({ id: "invoice-1", danfe_path: "/danfes/real.pdf" });
    (tempFileService.findById as jest.Mock).mockResolvedValue(null);
    (uploaderService.getFile as jest.Mock).mockResolvedValue(
      Buffer.from("uploaded-pdf"),
    );

    const buffer = await invoiceService.getDanfeBuffer("invoice-1");

    expect(uploaderService.getFile).toHaveBeenCalledWith("/danfes/real.pdf");
    expect(buffer.toString()).toBe("uploaded-pdf");
  });

  it("danfe_path interno normal (já finalizado) — serve via uploaderService, comportamento inalterado", async () => {
    repo.findById.mockResolvedValue({
      id: "invoice-1",
      danfe_path: "/danfes/real.pdf",
    });
    (uploaderService.getFile as jest.Mock).mockResolvedValue(
      Buffer.from("uploaded-pdf"),
    );

    const buffer = await invoiceService.getDanfeBuffer("invoice-1");

    expect(uploaderService.getFile).toHaveBeenCalledWith("/danfes/real.pdf");
    expect(buffer.toString()).toBe("uploaded-pdf");
  });
});

describe("InvoiceService.ensureUnitBusinessAttributes", () => {
  it("nota provisória enriquecida (sender E receiver resolvem pra unit business conhecida): cria os dois attributes, sender OUTGOING/OPEN e receiver INCOMING/initialStatus", async () => {
    (repo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([
      { id: "ub-sender", cnpj: "sender-cnpj" },
      { id: "ub-receiver", cnpj: "receiver-cnpj" },
    ]);
    (repo.findInvoiceAttribute as jest.Mock).mockResolvedValue(null);

    await invoiceService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "sender-cnpj",
      receiverCnpj: "receiver-cnpj",
      initialStatus: "WAITING_SCHEDULE_SALES",
    });

    expect(repo.createInvoiceAttributes).toHaveBeenCalledWith(
      [
        {
          invoice_id: "invoice-1",
          unit_business_id: "ub-sender",
          type: "OUTGOING",
          status: "OPEN",
          batch_generated: false,
        },
        {
          invoice_id: "invoice-1",
          unit_business_id: "ub-receiver",
          type: "INCOMING",
          status: "WAITING_SCHEDULE_SALES",
          batch_generated: false,
        },
      ],
      undefined,
    );
  });

  it("attribute já existe pro lado resolvido: não duplica (idempotente)", async () => {
    (repo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([
      { id: "ub-sender", cnpj: "sender-cnpj" },
    ]);
    (repo.findInvoiceAttribute as jest.Mock).mockResolvedValue({
      id: "existing-attr",
    });

    await invoiceService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "sender-cnpj",
      invoiceType: "OUTGOING",
    });

    expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("nenhum dos dois lados resolve pra unit business conhecida: não cria nada", async () => {
    (repo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([]);

    await invoiceService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "cnpj-desconhecido",
      receiverCnpj: "outro-cnpj-desconhecido",
    });

    expect(repo.findInvoiceAttribute).not.toHaveBeenCalled();
    expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("sem CNPJ nenhum informado: nem consulta o banco", async () => {
    await invoiceService.ensureUnitBusinessAttributes("invoice-1", {});

    expect(repo.findUnitBusinessesByCnpj).not.toHaveBeenCalled();
    expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
  });
});
