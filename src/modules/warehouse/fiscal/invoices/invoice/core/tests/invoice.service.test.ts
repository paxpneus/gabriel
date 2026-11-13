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


jest.mock("../../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})), literal: jest.fn((value: string) => value) },
}));

jest.mock("../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service", () => ({
  __esModule: true,
  default: { findTransferLinkableBySaleInvoiceIds: jest.fn(), setTransferInvoiceFromInvoiceFlow: jest.fn() },
}));

jest.mock("../repositories/invoice.repository", () => ({
  __esModule: true,
  default: {
    bulkUpdate: jest.fn(),
  },
}));

jest.mock("../../shared/repositories/transfer-reference.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
    findTransfersByIds: jest.fn(),
    findByTransferInvoiceIds: jest.fn(),
  },
}));

import mockedRepository from "../repositories/invoice.repository";
import mockedTransferReferenceRepository from "../../shared/repositories/transfer-reference.repository";
import invoiceService from "../services/invoice.service";
import mockedPdvService from "../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { transferReferenceService } from "../../shared";
import { AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";

const repo = mockedRepository as unknown as Record<string, jest.Mock>;
const transferRepo = mockedTransferReferenceRepository as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  transferRepo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  transferRepo.findByTransferReferenceNumbers.mockResolvedValue([]);
  transferRepo.findTransfersByIds.mockResolvedValue([{ id: "tr-1", number_system: "028921", normalized_number: "28921" }]);
  transferRepo.findByTransferInvoiceIds.mockResolvedValue([]);
});

describe("escrita do vínculo de transferência (PUT /bulk)", () => {
  const pdv = mockedPdvService as unknown as Record<string, jest.Mock>;
  const actor = { userId: "user-1", roleId: "role-1", origin: AuditOrigin.USER };
  let link: jest.SpyInstance;

  beforeEach(() => {
    pdv.findTransferLinkableBySaleInvoiceIds.mockResolvedValue([]);
    link = jest.spyOn(transferReferenceService, "linkTransferInvoice").mockResolvedValue(undefined);
    repo.findAll = jest.fn().mockResolvedValue([{ id: "inv-1" }]);
  });

  it("bulkUpdate: vínculo vai pelo linkTransferInvoice com quem alterou; resto do body no bulkUpdate", async () => {
    await invoiceService.bulkUpdate({ transfer_invoice_id: "tr-1", observation: "x" } as any, { where: { id: ["inv-1"] } }, actor);

    expect(link).toHaveBeenCalledWith(["inv-1"], "tr-1", actor, undefined);
    expect(repo.bulkUpdate).toHaveBeenCalledWith({ observation: "x" }, expect.anything());
  });

  it("bulkUpdate só com texto → recusado sem gravar", async () => {
    await expect(
      invoiceService.bulkUpdate({ transfer_invoice_reference: "REF: 99" }, { where: { id: ["inv-1"] } }, actor),
    ).rejects.toThrow("Selecione a nota de transferência na lista");
    expect(link).not.toHaveBeenCalled();
    expect(repo.bulkUpdate).not.toHaveBeenCalled();
  });
});
