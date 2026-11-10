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
    transaction: jest.fn((cb: any) => cb({ LOCK: { UPDATE: "UPDATE" } })),
    literal: jest.fn((value: string) => value),
  },
}));


jest.mock("../invoice.repository", () => ({
  __esModule: true,
  default: { findById: jest.fn(), findOne: jest.fn(), bulkUpdate: jest.fn() },
}));

jest.mock("../../../../../handlers/temp-file/temp-file.service", () => ({
  __esModule: true,
  default: { create: jest.fn(), findById: jest.fn() },
}));

jest.mock("../../../../../handlers/uploader/uploader.queue", () => ({
  __esModule: true,
  default: { enqueueUpload: jest.fn(), enqueueDelete: jest.fn() },
}));

jest.mock("../../../../../handlers/uploader/services/uploader.service", () => ({
  __esModule: true,
  default: { getFile: jest.fn() },
}));

jest.mock("../../../../../global/audit-logs/audit-log.service", () => ({
  __esModule: true,
  default: { record: jest.fn() },
}));

jest.mock("../helpers/correction-letter", () => ({
  __esModule: true,
  extractCorrectionLetterIdentification: jest.fn(),
}));

import mockedRepository from "../invoice.repository";
import invoiceService from "../invoice.service";
import tempFileService from "../../../../../handlers/temp-file/temp-file.service";
import uploaderQueue from "../../../../../handlers/uploader/uploader.queue";
import auditLogService from "../../../../../global/audit-logs/audit-log.service";
import { extractCorrectionLetterIdentification } from "../helpers/correction-letter";
import uploaderService from "../../../../../handlers/uploader/services/uploader.service";

const repo = mockedRepository as unknown as { findById: jest.Mock; findOne: jest.Mock; bulkUpdate: jest.Mock };
const KEY = "31261002316749002111550020000223071727382457";
const pdf = { buffer: Buffer.from("%PDF"), mimeType: "application/pdf" };
const letter = (overrides = {}) => ({ isCorrectionLetter: true, accessKey: KEY, number: "022307", ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
  (extractCorrectionLetterIdentification as jest.Mock).mockResolvedValue(letter());
  (tempFileService.create as jest.Mock).mockResolvedValue({ id: "temp-1" });
});

describe("InvoiceService.attachCorrectionLetter", () => {
  it("carta da própria nota → staging temp://, data, audit e upload na pasta de cartas com nome carta_correcao_<nº>_<data>", async () => {
    const attachedAt = new Date("2026-11-10T12:00:00Z");
    repo.findById
      .mockResolvedValueOnce({ id: "inv-1", number_system: "022307" }) // nota da rota
      .mockResolvedValueOnce({ correction_letter_path: null, correction_letter_attached_at: null }) // antes, travado
      .mockResolvedValueOnce({ correction_letter_path: "temp://temp-1", correction_letter_attached_at: attachedAt }) // depois
      .mockResolvedValueOnce({ id: "inv-1" });
    repo.findOne.mockResolvedValue({ id: "inv-1", number_system: "022307" });

    await invoiceService.attachCorrectionLetter("inv-1", pdf, "user-1");

    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { xml_key: KEY } }));
    const [tempData] = (tempFileService.create as jest.Mock).mock.calls[0];
    expect(tempData).toMatchObject({
      upload_directory: "/cartas-correcao",
      preserve_filename: true,
      entity_type: "INVOICE_CORRECTION_LETTER",
      entity_id: "inv-1",
    });
    expect(tempData.original_filename).toMatch(/^carta_correcao_022307_\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{2}\.pdf$/);
    const [data, options] = repo.bulkUpdate.mock.calls[0];
    expect(data.correction_letter_path).toBe("temp://temp-1");
    expect(options.where).toEqual({ id: "inv-1" });
    const [entries] = (auditLogService.record as jest.Mock).mock.calls[0];
    expect(entries[0]).toMatchObject({ entity: "INVOICE", internalId: "inv-1", userId: "user-1" });
    expect(entries[0].changes.summary).toContain("Carta de correção anexada na nota 022307");
    expect(uploaderQueue.enqueueUpload).toHaveBeenCalledWith("temp-1", "INVOICE_CORRECTION_LETTER");
    expect(uploaderQueue.enqueueDelete).not.toHaveBeenCalled();
  });

  it("substituição → apaga a carta anterior da nuvem", async () => {
    repo.findById
      .mockResolvedValueOnce({ id: "inv-1", number_system: "022307" })
      .mockResolvedValueOnce({ correction_letter_path: "/cartas-correcao/antiga.pdf", correction_letter_attached_at: new Date() })
      .mockResolvedValueOnce({ correction_letter_path: "temp://temp-1", correction_letter_attached_at: new Date() })
      .mockResolvedValueOnce({ id: "inv-1" });
    repo.findOne.mockResolvedValue({ id: "inv-1", number_system: "022307" });

    await invoiceService.attachCorrectionLetter("inv-1", pdf, "user-1");

    expect(uploaderQueue.enqueueDelete).toHaveBeenCalledWith(
      { type: "real-path", path: "/cartas-correcao/antiga.pdf" },
      "INVOICE_CORRECTION_LETTER",
    );
  });

  it.each([
    ["não é PDF", { ...pdf, mimeType: "image/png" }, letter(), "Envie a carta de correção em PDF."],
    ["não é carta de correção", pdf, letter({ isCorrectionLetter: false }), "O arquivo enviado não é uma carta de correção."],
    [
      "sem chave legível",
      pdf,
      letter({ accessKey: null }),
      "Não foi possível ler a chave de acesso e o número da nota na carta de correção.",
    ],
  ])("%s → recusa sem gravar", async (_case, file, extracted, message) => {
    (extractCorrectionLetterIdentification as jest.Mock).mockResolvedValue(extracted);
    await expect(invoiceService.attachCorrectionLetter("inv-1", file, "user-1")).rejects.toThrow(message);
    expect(repo.bulkUpdate).not.toHaveBeenCalled();
  });

  it("carta de outra nota → recusa dizendo de qual nota ela é", async () => {
    repo.findById.mockResolvedValueOnce({ id: "inv-1", number_system: "022098" });
    repo.findOne.mockResolvedValue({ id: "inv-2", number_system: "022307" });

    await expect(invoiceService.attachCorrectionLetter("inv-1", pdf, "user-1")).rejects.toThrow(
      "A carta de correção enviada é da nota 022307, não da nota 022098.",
    );
    expect(repo.bulkUpdate).not.toHaveBeenCalled();
  });

  it("chave bate mas número não → recusa", async () => {
    (extractCorrectionLetterIdentification as jest.Mock).mockResolvedValue(letter({ number: "999" }));
    repo.findById.mockResolvedValueOnce({ id: "inv-1", number_system: "022307" });
    repo.findOne.mockResolvedValue({ id: "inv-1", number_system: "022307" });

    await expect(invoiceService.attachCorrectionLetter("inv-1", pdf, "user-1")).rejects.toThrow(
      "O número da nota na carta de correção (999) não confere com a nota 022307.",
    );
  });

  it("chave não existe no banco → recusa", async () => {
    repo.findById.mockResolvedValueOnce({ id: "inv-1", number_system: "022307" });
    repo.findOne.mockResolvedValue(null);

    await expect(invoiceService.attachCorrectionLetter("inv-1", pdf, "user-1")).rejects.toThrow(
      "A nota da carta de correção (nº 022307) não foi encontrada no sistema.",
    );
  });
});

describe("InvoiceService.getCorrectionLetterFile", () => {
  it("baixa da nuvem com o nome do arquivo", async () => {
    repo.findById.mockResolvedValue({ id: "inv-1", correction_letter_path: "/cartas-correcao/carta_correcao_022307_10-11-2026_14-32-05.pdf" });
    (uploaderService.getFile as jest.Mock).mockResolvedValue(Buffer.from("%PDF"));

    await expect(invoiceService.getCorrectionLetterFile("inv-1")).resolves.toEqual({
      buffer: Buffer.from("%PDF"),
      filename: "carta_correcao_022307_10-11-2026_14-32-05.pdf",
    });
    expect(uploaderService.getFile).toHaveBeenCalledWith("/cartas-correcao/carta_correcao_022307_10-11-2026_14-32-05.pdf");
  });

  it.each([
    ["nota inexistente", null, "Nota fiscal não encontrada"],
    ["nota sem carta", { id: "inv-1", correction_letter_path: null }, "A nota não tem carta de correção anexada."],
  ])("%s → erro sem ir à nuvem", async (_case, invoice, message) => {
    repo.findById.mockResolvedValue(invoice);
    await expect(invoiceService.getCorrectionLetterFile("inv-1")).rejects.toThrow(message);
    expect(uploaderService.getFile).not.toHaveBeenCalled();
  });

  it("ainda em temp:// → serve do staging com o nome que vai pra nuvem", async () => {
    repo.findById.mockResolvedValue({ id: "inv-1", correction_letter_path: "temp://temp-1" });
    (tempFileService.findById as jest.Mock).mockResolvedValue({
      id: "temp-1",
      buffer: Buffer.from("%PDF-temp"),
      original_filename: "carta_correcao_022307_10-11-2026_14-32-05.pdf",
    });

    await expect(invoiceService.getCorrectionLetterFile("inv-1")).resolves.toEqual({
      buffer: Buffer.from("%PDF-temp"),
      filename: "carta_correcao_022307_10-11-2026_14-32-05.pdf",
    });
    expect(tempFileService.findById).toHaveBeenCalledWith("temp-1", expect.anything());
    expect(uploaderService.getFile).not.toHaveBeenCalled();
  });

  it("upload terminou entre as leituras → relê o path e baixa da nuvem", async () => {
    repo.findById
      .mockResolvedValueOnce({ id: "inv-1", correction_letter_path: "temp://temp-1" })
      .mockResolvedValueOnce({ id: "inv-1", correction_letter_path: "/cartas-correcao/c.pdf" });
    (tempFileService.findById as jest.Mock).mockResolvedValue(null);
    (uploaderService.getFile as jest.Mock).mockResolvedValue(Buffer.from("%PDF"));

    await expect(invoiceService.getCorrectionLetterFile("inv-1")).resolves.toEqual({
      buffer: Buffer.from("%PDF"),
      filename: "c.pdf",
    });
  });
});
