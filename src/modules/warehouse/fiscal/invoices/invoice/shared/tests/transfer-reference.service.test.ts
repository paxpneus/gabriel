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
  default: { transaction: jest.fn((cb: any) => cb({})), literal: jest.fn((value: string) => value) },
}));

jest.mock("../repositories/transfer-reference.repository", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn(),
    findExistingTransferNumbers: jest.fn(),
    findByTransferReferenceNumbers: jest.fn(),
    findTransfersByIds: jest.fn(),
    findByTransferInvoiceIds: jest.fn(),
    findForTransferLink: jest.fn(),
    updateTransferLink: jest.fn(),
  },
}));

jest.mock("../../../../../../global/audit-logs/audit-log.service", () => ({
  __esModule: true,
  default: { record: jest.fn() },
}));

jest.mock("../../../../../../company/users/roles/role.service", () => ({
  __esModule: true,
  default: { isAdminRole: jest.fn() },
}));

import auditLogService from "../../../../../../global/audit-logs/audit-log.service";
import roleService from "../../../../../../company/users/roles/role.service";
import { AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";
import { splitTransferLinkWrite } from "../helpers/transfer-reference";
import mockedRepository from "../repositories/transfer-reference.repository";
import transferReferenceService from "../services/transfer-reference.service";

const repo = mockedRepository as unknown as Record<string, jest.Mock>;
const t = { id: "tx" } as any;

beforeEach(() => {
  jest.clearAllMocks();
  repo.findExistingTransferNumbers.mockResolvedValue(new Set(["28921"]));
  repo.findByTransferReferenceNumbers.mockResolvedValue([]);
  repo.findTransfersByIds.mockResolvedValue([{ id: "tr-1", number_system: "028921", normalized_number: "28921" }]);
  repo.findByTransferInvoiceIds.mockResolvedValue([]);
});

describe("TransferReferenceService.assertTransferReferences", () => {
  it("consulta existência e uso numa query cada, com os números distintos; problema → erro", async () => {
    repo.findByTransferReferenceNumbers.mockResolvedValue([
      { id: "inv-other", number_system: "005743", transfer_number: "28921" },
    ]);

    await expect(
      transferReferenceService.assertTransferReferences(
        [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: "REF: 028921" }],
        "Fim.",
      ),
    ).rejects.toThrow(
      "Nota(s) de transferência já vinculadas a outra nota de venda: 28921 (ref. a nota de venda 019794, já usada pela nota de venda 005743). Fim.",
    );
    expect(repo.findExistingTransferNumbers).toHaveBeenCalledWith(["28921"]);
    expect(repo.findByTransferReferenceNumbers).toHaveBeenCalledWith(["28921"]);
  });

  it("checkAlreadyUsed: false → uso nem é consultado (lista vazia)", async () => {
    await transferReferenceService.assertTransferReferences(
      [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: "REF: 28921" }],
      "Fim.",
      { checkAlreadyUsed: false },
    );
    expect(repo.findByTransferReferenceNumbers).toHaveBeenCalledWith([]);
  });
});

describe("TransferReferenceService.assertTransferReferences por id", () => {
  it("ref com transferInvoiceId → consulta por id, não pelo número", async () => {
    await transferReferenceService.assertTransferReferences(
      [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: "REF: 99", transferInvoiceId: "tr-1" }],
      "Fim.",
    );
    expect(repo.findTransfersByIds).toHaveBeenCalledWith(["tr-1"]);
    expect(repo.findByTransferInvoiceIds).toHaveBeenCalledWith(["tr-1"]);
    expect(repo.findExistingTransferNumbers).toHaveBeenCalledWith([]);
    expect(repo.findByTransferReferenceNumbers).toHaveBeenCalledWith([]);
  });

  it("outra nota já vinculada ao mesmo id → erro com o número da transferência", async () => {
    repo.findByTransferInvoiceIds.mockResolvedValue([{ id: "inv-other", number_system: "005743", transfer_invoice_id: "tr-1" }]);

    await expect(
      transferReferenceService.assertTransferReferences(
        [{ invoiceId: "inv-1", invoiceNumber: "019794", reference: null, transferInvoiceId: "tr-1" }],
        "Fim.",
      ),
    ).rejects.toThrow(
      "Nota(s) de transferência já vinculadas a outra nota de venda: 28921 (ref. a nota de venda 019794, já usada pela nota de venda 005743). Fim.",
    );
  });
});

describe("TransferReferenceService.linkTransferInvoice (único escritor do vínculo)", () => {
  const sale = (overrides: Record<string, unknown> = {}) => ({
    id: "inv-1",
    number_system: "019794",
    transfer_invoice_id: null,
    transfer_invoice_reference: null,
    finished_at_sender: false,
    ...overrides,
  });
  const actor = { userId: "user-1", roleId: "role-1", origin: AuditOrigin.USER };

  it("vincula: valida 1 ↔ 1, grava id + REF e audita na nota de venda, na transação do chamador", async () => {
    repo.findForTransferLink
      .mockResolvedValueOnce([sale()])
      .mockResolvedValueOnce([sale({ transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921" })]);

    await transferReferenceService.linkTransferInvoice(["inv-1"], "tr-1", actor, t);

    expect(repo.findForTransferLink).toHaveBeenNthCalledWith(1, ["inv-1"], t);
    expect(repo.updateTransferLink).toHaveBeenCalledWith(
      ["inv-1"],
      { transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921" },
      t,
    );
    const [entries, transaction] = (auditLogService.record as jest.Mock).mock.calls[0];
    expect(transaction).toBe(t);
    expect(entries[0]).toMatchObject({
      userId: "user-1",
      origin: AuditOrigin.USER,
      entity: "INVOICE",
      internalId: "inv-1",
      changes: {
        summary: "Nota de transferência REF: 28921 vinculada na nota de venda 019794",
        before: { transfer_invoice_id: null, transfer_invoice_reference: null },
        after: { transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921" },
      },
    });
  });

  it("transferência já usada por outra nota → erro, nada gravado", async () => {
    repo.findForTransferLink.mockResolvedValueOnce([sale()]);
    repo.findByTransferInvoiceIds.mockResolvedValue([{ id: "inv-other", number_system: "005743", transfer_invoice_id: "tr-1" }]);

    await expect(transferReferenceService.linkTransferInvoice(["inv-1"], "tr-1", actor, t)).rejects.toThrow(
      "Revise a nota de transferência informada.",
    );
    expect(repo.updateTransferLink).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it("nota finalizada na emitente sem admin → erro, nada gravado", async () => {
    repo.findForTransferLink.mockResolvedValueOnce([sale({ finished_at_sender: true })]);
    (roleService.isAdminRole as jest.Mock).mockResolvedValue(false);

    await expect(transferReferenceService.linkTransferInvoice(["inv-1"], "tr-1", actor, t)).rejects.toThrow(
      "Apenas administradores podem alterar a nota de transferência de nota de venda finalizada: 019794.",
    );
    expect(repo.updateTransferLink).not.toHaveBeenCalled();
  });

  it("nota finalizada na emitente com admin → grava", async () => {
    repo.findForTransferLink
      .mockResolvedValueOnce([sale({ finished_at_sender: true })])
      .mockResolvedValueOnce([sale({ transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921" })]);
    (roleService.isAdminRole as jest.Mock).mockResolvedValue(true);

    await transferReferenceService.linkTransferInvoice(["inv-1"], "tr-1", actor, t);

    expect(roleService.isAdminRole).toHaveBeenCalledWith("role-1");
    expect(repo.updateTransferLink).toHaveBeenCalled();
  });

  it("remover pelo link do PDV → limpa os dois e audita marcando o link", async () => {
    repo.findForTransferLink
      .mockResolvedValueOnce([sale({ transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921" })])
      .mockResolvedValueOnce([sale()]);

    await transferReferenceService.linkTransferInvoice(["inv-1"], null, { userId: null, origin: AuditOrigin.PDV }, t);

    expect(repo.findTransfersByIds).not.toHaveBeenCalled();
    expect(repo.updateTransferLink).toHaveBeenCalledWith(
      ["inv-1"],
      { transfer_invoice_id: null, transfer_invoice_reference: null },
      t,
    );
    const [entries] = (auditLogService.record as jest.Mock).mock.calls[0];
    expect(entries[0]).toMatchObject({
      userId: null,
      origin: AuditOrigin.PDV,
      changes: {
        summary: "Nota de transferência REF: 28921 removida da nota de venda 019794 (pelo link do PDV, sem usuário logado)",
      },
    });
  });

  it("vínculo igual ao atual → não grava nem audita (nem pede admin)", async () => {
    repo.findForTransferLink.mockResolvedValueOnce([
      sale({ transfer_invoice_id: "tr-1", transfer_invoice_reference: "REF: 28921", finished_at_sender: true }),
    ]);

    await transferReferenceService.linkTransferInvoice(["inv-1"], "tr-1", actor, t);

    expect(repo.updateTransferLink).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
    expect(roleService.isAdminRole).not.toHaveBeenCalled();
  });
});

describe("splitTransferLinkWrite (body genérico: PUT /:id, PUT /bulk, lote)", () => {
  it("transfer_invoice_id → vínculo; resto do body separado", () => {
    expect(splitTransferLinkWrite({ transfer_invoice_id: "tr-1", observation: "x" } as any)).toEqual({
      transferInvoiceId: "tr-1",
      rest: { observation: "x" },
    });
  });

  it("texto sem id → recusado (vínculo só por id/XML/DANFE)", () => {
    expect(() => splitTransferLinkWrite({ transfer_invoice_reference: "REF: 28921" })).toThrow(
      "Selecione a nota de transferência na lista",
    );
  });

  it.each([[{ transfer_invoice_id: null }], [{ transfer_invoice_reference: null }], [{ transfer_invoice_reference: "" }]])(
    "limpando (%p) → remove o vínculo",
    (input) => {
      expect(splitTransferLinkWrite(input as any).transferInvoiceId).toBeNull();
    },
  );

  it("sem os campos do vínculo → não mexe", () => {
    expect(splitTransferLinkWrite({ observation: "x" } as any)).toEqual({ transferInvoiceId: undefined, rest: { observation: "x" } });
  });
});
