// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../config/redis", () => ({
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

// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

const mockTransaction = { LOCK: { UPDATE: "UPDATE" } } as any;
jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock("../../../fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));

jest.mock(
  "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service",
  () => ({
    __esModule: true,
    default: { findUnmappedByInvoiceIds: jest.fn() },
  }),
);

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../../utils/helpers/transshipment-resolver", () => ({
  __esModule: true,
  assertTransshipment: jest.fn(),
}));

jest.mock("../../batch-invoices/batch-invoices.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), createBatchInvoiceWithItems: jest.fn() },
}));

jest.mock("../../../transporter/transporter.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../../../shared/utils/normalizers/batch-nomenclature", () => ({
  __esModule: true,
  setBatchNumber: jest.fn(),
}));

jest.mock(
  "../../../../sales/pdv-management/sales-request/pdv-sales-request.service",
  () => ({
    __esModule: true,
    default: {
      assertNoCriticalErrorForSaleInvoices: jest.fn(),
      finishIfDeliveryNoteGenerated: jest.fn(),
    },
  }),
);

jest.mock("../../../../global/audit-logs/audit-log.service", () => ({
  __esModule: true,
  default: { record: jest.fn(), paginateByEntity: jest.fn() },
}));

jest.mock("../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../helpers/transfer-reference", () => ({
  __esModule: true,
  assertAdtBatchTransferReferences: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../../handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  ...jest.requireActual("../../../../handlers/bling/api/bling_api.service"),
  getBlingIntegration: jest.fn().mockResolvedValue({ id: "bling-int", name: "Bling" }),
}));

import { assertAdtBatchTransferReferences } from "../helpers/transfer-reference";
import auditLogService from "../../../../global/audit-logs/audit-log.service";
import userService from "../../../../company/users/users/user.service";
import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import batchInvoicesService from "../../batch-invoices/batch-invoices.service";
import unmappedInvoiceProductService from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import { assertTransshipment } from "../../utils/helpers/transshipment-resolver";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { ExpeditionBatchService } from "../batch.service";

function makeInvoice(overrides: Partial<any> = {}) {
  return {
    id: "invoice-1",
    number_system: "1001",
    transporter_name: "Transportadora X",
    items: [{ id: "item-1" }],
    get: (opts?: any) => ({
      id: "invoice-1",
      number_system: "1001",
      transporter_name: "Transportadora X",
      items: [{ id: "item-1" }],
      unitBusinessAttributes: [],
      ...overrides,
    }),
    ...overrides,
  };
}

describe("ExpeditionBatchService — bloqueio de lote com nota não mapeada", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({
      id: "ub-1",
      number: "01",
    });
  });

  describe("generateBatchFromInvoices", () => {
    it("nota com unmapped UNMAPPED: bloqueia ANTES de assertTransshipment, com a mensagem e o número da nota", async () => {
      const invoice = makeInvoice();
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [{ id: "unmapped-1", invoice_id: "invoice-1", invoice: { number_system: "1001" } }],
      );

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING"),
      ).rejects.toThrow(/Nota\(s\) com produtos não mapeados.*1001/);

      expect(assertTransshipment).not.toHaveBeenCalled();
    });

    it("sem unmapped: não bloqueia — passa da checagem e chega em assertTransshipment", async () => {
      const invoice = makeInvoice();
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [],
      );
      // Deixa a função "morrer" logo depois da checagem de unmapped, num
      // ponto que só é alcançado se ela NÃO bloqueou — sem precisar mockar
      // todo o resto de generateBatchFromInvoices (setBatchNumber, etc).
      (assertTransshipment as jest.Mock).mockRejectedValue(
        new Error("SENTINEL_PASSOU_DO_UNMAPPED"),
      );

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING"),
      ).rejects.toThrow("SENTINEL_PASSOU_DO_UNMAPPED");

      expect(
        unmappedInvoiceProductService.findUnmappedByInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-1"], mockTransaction);
    });
  });

  describe("addInvoiceToBatch", () => {
    describe("com transfer_invoice_reference (validação 1 venda ↔ 1 transferência fica no updateInvoices)", () => {
      const keys = ["29260802036483000614550010004404561245674661", "29260802036483000614550010004404561245674662"];

      beforeEach(() => {
        (invoiceService.findAll as jest.Mock).mockResolvedValue([
          makeInvoice({ id: "invoice-1", number_system: "1001", xml_key: keys[0] }),
          makeInvoice({ id: "invoice-2", number_system: "1002", xml_key: keys[1] }),
        ]);
        (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue([]);
        (pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices as jest.Mock).mockResolvedValue(undefined);
        (assertTransshipment as jest.Mock).mockResolvedValue(undefined);
        (batchInvoicesService as any).findAll = jest.fn().mockResolvedValue([]);
      });

      it("lote existente: grava a referência nas notas novas na transação — erro do updateInvoices propaga", async () => {
        jest.spyOn(service, "findById").mockResolvedValue({ id: "batch-1" } as any);
        jest
          .spyOn(service, "findByIdFullBatch")
          .mockResolvedValue({ id: "batch-1", status: "OPEN", mode: "REGULAR", transporters_id: null } as any);
        (batchInvoicesService.createBatchInvoiceWithItems as jest.Mock).mockResolvedValue({ volumesAdded: 2 });
        jest.spyOn(service, "increment").mockResolvedValue(undefined);
        (invoiceService as any).updateInvoices = jest.fn().mockRejectedValue(new Error("já vinculada"));

        await expect(
          service.addInvoiceToBatch(keys, "ub-1", "OUTGOING", "batch-1", "REF: 28921"),
        ).rejects.toThrow("já vinculada");

        expect((invoiceService as any).updateInvoices).toHaveBeenCalledWith(
          ["invoice-1", "invoice-2"],
          "ub-1",
          { transfer_invoice_reference: "REF: 28921" },
          undefined,
          mockTransaction,
        );
      });

      it("lote novo (texto ignorado ao criar) → não grava nem valida a referência", async () => {
        (invoiceService as any).updateInvoices = jest.fn();
        jest.spyOn(service as any, "createBatchStructure").mockRejectedValue(new Error("SENTINEL_CRIOU"));

        await expect(
          service.addInvoiceToBatch(keys, "ub-1", "OUTGOING", undefined, "REF: 28921"),
        ).rejects.toThrow("SENTINEL_CRIOU");

        expect((invoiceService as any).updateInvoices).not.toHaveBeenCalled();
      });
    });

    it("nota com unmapped UNMAPPED: bloqueia ANTES de assertTransshipment, com a mensagem e o número da nota", async () => {
      const invoice = makeInvoice({
        xml_key: "29260802036483000614550010004404561245674661",
      });
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [{ id: "unmapped-1", invoice_id: "invoice-1", invoice: { number_system: "1001" } }],
      );

      await expect(
        service.addInvoiceToBatch(["29260802036483000614550010004404561245674661"], "ub-1", "OUTGOING"),
      ).rejects.toThrow(/Nota\(s\) com produtos não mapeados.*1001/);

      expect(assertTransshipment).not.toHaveBeenCalled();
    });

    it("sem unmapped: não bloqueia — passa da checagem e chega em assertTransshipment", async () => {
      const invoice = makeInvoice({
        xml_key: "29260802036483000614550010004404561245674661",
      });
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [],
      );
      (assertTransshipment as jest.Mock).mockRejectedValue(
        new Error("SENTINEL_PASSOU_DO_UNMAPPED"),
      );

      await expect(
        service.addInvoiceToBatch(["29260802036483000614550010004404561245674661"], "ub-1", "OUTGOING"),
      ).rejects.toThrow("SENTINEL_PASSOU_DO_UNMAPPED");

      expect(
        unmappedInvoiceProductService.findUnmappedByInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-1"], mockTransaction);
    });
  });
});

// Pedido PDV em CRITICAL_ERROR barra lote e romaneio da nota de venda.
describe("ExpeditionBatchService — bloqueio de nota com pedido PDV em CRITICAL_ERROR", () => {
  const CRITICAL_ERROR_MESSAGE =
    "Pedido da(s) nota(s) 1001 tem erros críticos — ajuste no quadro PDV antes de gerar lote/romaneio";
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({
      id: "ub-1",
      number: "01",
    });
    (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
      [],
    );
    (
      pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices as jest.Mock
    ).mockRejectedValue(new Error(CRITICAL_ERROR_MESSAGE));
  });

  it("generateBatchFromInvoices: rejeita antes de assertTransshipment", async () => {
    (invoiceService.findAll as jest.Mock).mockResolvedValue([makeInvoice()]);

    await expect(
      service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING"),
    ).rejects.toThrow(CRITICAL_ERROR_MESSAGE);

    expect(
      pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices,
    ).toHaveBeenCalledWith(["invoice-1"]);
    expect(assertTransshipment).not.toHaveBeenCalled();
  });

  it("addInvoiceToBatch: rejeita antes de assertTransshipment", async () => {
    const key = "29260802036483000614550010004404561245674661";
    (invoiceService.findAll as jest.Mock).mockResolvedValue([
      makeInvoice({ xml_key: key }),
    ]);

    await expect(
      service.addInvoiceToBatch([key], "ub-1", "OUTGOING"),
    ).rejects.toThrow(CRITICAL_ERROR_MESSAGE);

    expect(
      pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices,
    ).toHaveBeenCalledWith(["invoice-1"]);
    expect(assertTransshipment).not.toHaveBeenCalled();
  });

  it("generateDeliveryNote: rejeita sem gravar delivery_note_generated_at", async () => {
    jest.spyOn(service, "findByIdFullBatch").mockResolvedValue({
      id: "batch-1",
      status: "FINISHED",
      delivery_note_generated_at: null,
      operator_id: null,
      batchInvoices: [{ invoice_id: "invoice-1", invoice: { number_system: "1001" } }],
    } as any);
    const update = jest
      .spyOn((service as any).repository, "bulkUpdate")
      .mockResolvedValue({} as any);

    await expect(
      service.generateDeliveryNote("batch-1", "user-1", "actor-1"),
    ).rejects.toThrow(CRITICAL_ERROR_MESSAGE);

    expect(
      pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices,
    ).toHaveBeenCalledWith(["invoice-1"]);
    expect(update).not.toHaveBeenCalled();
    expect(pdvSalesRequestService.finishIfDeliveryNoteGenerated).not.toHaveBeenCalled();
  });

  it.each(["OPEN", "PENDING"])(
    "generateDeliveryNote: lote %s → rejeita sem gravar romaneio",
    async (status) => {
      jest.spyOn(service, "findByIdFullBatch").mockResolvedValue({
        id: "batch-1",
        number: "42",
        status,
        delivery_note_generated_at: null,
        operator_id: null,
        batchInvoices: [{ invoice_id: "invoice-1", invoice: { number_system: "1001" } }],
      } as any);
      const update = jest
        .spyOn((service as any).repository, "bulkUpdate")
        .mockResolvedValue({} as any);

      await expect(
        service.generateDeliveryNote("batch-1", "user-1", "actor-1"),
      ).rejects.toThrow(
        "O lote 42 ainda não foi finalizado. Finalize o lote antes de gerar o romaneio.",
      );
      expect(update).not.toHaveBeenCalled();
    },
  );
});

describe("ExpeditionBatchService — operador do romaneio", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    // O describe anterior deixa este mock rejeitando.
    (
      pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices as jest.Mock
    ).mockResolvedValue(undefined);
    service = new ExpeditionBatchService();
  });

  it("generateDeliveryNote: grava data e operador com COALESCE num UPDATE só, na transação (não sobrescreve o que já está no banco)", async () => {
    jest.spyOn(service, "findByIdFullBatch").mockResolvedValue({
      id: "batch-1",
      number: "42",
      status: "FINISHED",
      batchInvoices: [{ invoice_id: "invoice-1", invoice: { number_system: "1001" } }],
    } as any);
    jest
      .spyOn(service, "findOne")
      .mockResolvedValueOnce({ delivery_note_generated_at: null, operator_id: null } as any)
      .mockResolvedValueOnce({ delivery_note_generated_at: new Date(), operator_id: "user-1" } as any);
    (userService.findById as jest.Mock).mockResolvedValue({ name: "Fulano" });
    const bulkUpdate = jest
      .spyOn((service as any).repository, "bulkUpdate")
      .mockResolvedValue([1] as any);
    const update = jest.spyOn((service as any).repository, "update");

    await service.generateDeliveryNote("batch-1", "user-1", "actor-1");

    expect(update).not.toHaveBeenCalled();
    const [data, options] = bulkUpdate.mock.calls[0] as any[];
    expect(options).toEqual({ where: { id: "batch-1" }, transaction: mockTransaction });
    expect(data.operator_id).toMatchObject({
      fn: "COALESCE",
      args: [{ col: "operator_id" }, "user-1"],
    });
    expect(data.delivery_note_generated_at).toMatchObject({
      fn: "COALESCE",
      args: [{ col: "delivery_note_generated_at" }, { fn: "NOW" }],
    });
  });

  it("generateDeliveryNote: audita quem gerou (usuário logado) com antes travado e depois do banco", async () => {
    const generatedAt = new Date("2026-10-30T13:00:00Z");
    jest.spyOn(service, "findByIdFullBatch").mockResolvedValue({
      id: "batch-1",
      number: "42",
      status: "FINISHED",
      batchInvoices: [],
    } as any);
    const findOne = jest
      .spyOn(service, "findOne")
      .mockResolvedValueOnce({ delivery_note_generated_at: null, operator_id: null } as any)
      .mockResolvedValueOnce({ delivery_note_generated_at: generatedAt, operator_id: "user-1" } as any);
    (userService.findById as jest.Mock).mockResolvedValue({ name: "Fulano" });
    jest.spyOn((service as any).repository, "bulkUpdate").mockResolvedValue([1] as any);

    await service.generateDeliveryNote("batch-1", "user-1", "actor-1");

    expect(findOne.mock.calls[0][0]).toMatchObject({ lock: "UPDATE", transaction: mockTransaction });
    const [entries, t] = (auditLogService.record as jest.Mock).mock.calls[0];
    expect(t).toBe(mockTransaction);
    expect(entries).toEqual([
      expect.objectContaining({
        userId: "actor-1",
        entity: "EXPEDITION_BATCH",
        internalId: "batch-1",
        action: "UPDATE",
        changes: expect.objectContaining({
          summary: "Romaneio do lote 42 gerado. Operador: Fulano",
          before: { delivery_note_generated_at: null, operator_name: null },
          after: { delivery_note_generated_at: generatedAt, operator_name: "Fulano" },
        }),
      }),
    ]);
  });

  it("generateDeliveryNote: romaneio já gerado → audita como gerado novamente, com o operador mantido", async () => {
    const firstAt = new Date("2026-10-29T13:00:00Z");
    jest.spyOn(service, "findByIdFullBatch").mockResolvedValue({
      id: "batch-1",
      number: "42",
      status: "FINISHED",
      batchInvoices: [],
    } as any);
    jest
      .spyOn(service, "findOne")
      .mockResolvedValue({ delivery_note_generated_at: firstAt, operator_id: "user-old" } as any);
    (userService.findById as jest.Mock).mockResolvedValue({ name: "Beltrano" });
    jest.spyOn((service as any).repository, "bulkUpdate").mockResolvedValue([1] as any);

    await service.generateDeliveryNote("batch-1", "user-1", "actor-1");

    expect(userService.findById).toHaveBeenCalledWith(
      "user-old",
      expect.objectContaining({ attributes: ["name"] }),
    );
    const [entries] = (auditLogService.record as jest.Mock).mock.calls[0];
    expect(entries[0].changes.summary).toBe(
      "Romaneio do lote 42 gerado novamente. Operador: Beltrano",
    );
  });

  it("update: lote com outro operador → rejeita sem gravar", async () => {
    const findOne = jest
      .spyOn(service, "findOne")
      .mockResolvedValue({ number: "42" } as any);
    const update = jest.spyOn((service as any).repository, "update");

    await expect(
      service.update("batch-1", { operator_id: "user-2" } as any),
    ).rejects.toThrow(
      "O operador do romaneio do lote 42 já foi definido e não pode ser alterado.",
    );
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: ["number"] }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("bulkUpdate: algum lote com outro operador → rejeita sem gravar", async () => {
    jest.spyOn(service, "findOne").mockResolvedValue({ number: "7" } as any);
    const bulkUpdate = jest.spyOn((service as any).repository, "bulkUpdate");

    await expect(
      service.bulkUpdate({ operator_id: null } as any, {
        where: { id: ["batch-1", "batch-2"] },
      }),
    ).rejects.toThrow(
      "O operador do romaneio do lote 7 já foi definido e não pode ser alterado.",
    );
    expect(bulkUpdate).not.toHaveBeenCalled();
  });

  it("update: lote sem operador (ou mesmo valor) → grava", async () => {
    jest.spyOn(service, "findOne").mockResolvedValue(null);
    const update = jest
      .spyOn((service as any).repository, "update")
      .mockResolvedValue({ id: "batch-1" } as any);

    await service.update("batch-1", { operator_id: "user-1" } as any);

    expect(update).toHaveBeenCalledWith("batch-1", { operator_id: "user-1" }, undefined);
  });

  it("update sem operator_id no body → nem consulta", async () => {
    const findOne = jest.spyOn(service, "findOne");
    jest
      .spyOn((service as any).repository, "update")
      .mockResolvedValue({ id: "batch-1" } as any);

    await service.update("batch-1", { status: "PENDING" } as any);

    expect(findOne).not.toHaveBeenCalled();
  });
});

describe("ExpeditionBatchService — histórico de auditoria", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
  });

  it("lote inexistente → Lote não encontrado (controller devolve 404)", async () => {
    jest.spyOn(service, "findById").mockResolvedValue(null);

    await expect(service.findAuditLogs("batch-1", {})).rejects.toThrow("Lote não encontrado");
    expect(auditLogService.paginateByEntity).not.toHaveBeenCalled();
  });

  it("lote existe → paginação genérica pela entidade EXPEDITION_BATCH", async () => {
    jest.spyOn(service, "findById").mockResolvedValue({ id: "batch-1" } as any);
    (auditLogService.paginateByEntity as jest.Mock).mockResolvedValue({ data: [] });

    await expect(service.findAuditLogs("batch-1", { page: 2 })).resolves.toEqual({ data: [] });
    expect(auditLogService.paginateByEntity).toHaveBeenCalledWith("EXPEDITION_BATCH", "batch-1", { page: 2 });
  });
});

describe("ExpeditionBatchService — filtro por data do romaneio", () => {
  const { Op } = jest.requireActual("sequelize");
  const { QueryParser } = jest.requireActual("../../../../../shared/query/query.parser");
  const service = new ExpeditionBatchService();
  const parse = (filters: Record<string, unknown>) =>
    QueryParser.parse({ filters }, (service as any).queryConfig).where;

  it("dia inteiro em horário de Brasília (00:00 a 23:59:59.999 SP), sem perder o delivery_note_generated", () => {
    const where = parse({
      delivery_note_generated: "true",
      delivery_note_generated_at: { start: "2026-10-30", end: "2026-10-30" },
    });

    expect(where.delivery_note_generated_at).toEqual({ [Op.not]: null });
    const range = where[Op.and][0].delivery_note_generated_at;
    expect(range[Op.gte].toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(range[Op.lte].toISOString()).toBe("2026-10-31T02:59:59.999Z");
  });

  it("data fora de AAAA-MM-DD → erro", () => {
    expect(() =>
      parse({ delivery_note_generated_at: { start: "2026-10-30'; DROP TABLE x; --" } }),
    ).toThrow("Data do romaneio inválida (use AAAA-MM-DD)");
  });
});

describe("ExpeditionBatchService — romaneio da logística própria (CD 12/17)", () => {
  it("helper de referência da transferência rejeita → bloqueia sem gravar", async () => {
    jest.clearAllMocks();
    const service = new ExpeditionBatchService();
    const batch = { id: "batch-1", number: "42", status: "FINISHED", batchInvoices: [] } as any;
    jest.spyOn(service, "findByIdFullBatch").mockResolvedValue(batch);
    (assertAdtBatchTransferReferences as jest.Mock).mockRejectedValueOnce(new Error("sem referência"));
    const bulkUpdate = jest.spyOn((service as any).repository, "bulkUpdate");

    await expect(service.generateDeliveryNote("batch-1", "user-1", "actor-1")).rejects.toThrow("sem referência");
    expect(assertAdtBatchTransferReferences).toHaveBeenCalledWith(batch);
    expect(bulkUpdate).not.toHaveBeenCalled();
  });
});


// Lote de entrada com nota Bling: avaliação da conciliação por job (1ª etapa) e trava no gerar lote (2ª etapa).
describe("ExpeditionBatchService — conciliação dos produtos na Bling (lote de entrada)", () => {
  let service: ExpeditionBatchService;
  let getJob: jest.Mock;
  let add: jest.Mock;

  const blingInvoice = (overrides: Partial<any> = {}) =>
    makeInvoice({
      number_system: "438864",
      id_system: "26454378751",
      integrations_id: "bling-int",
      xml_key: "29260702036483000614550010004388641821277941",
      ...overrides,
    });

  const completedJob = (invoices: any[]) => ({
    getState: jest.fn().mockResolvedValue("completed"),
    returnvalue: { invoices },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    getJob = jest.fn();
    add = jest.fn();
    (service as any).blingApiFetchQueue = { queue: { getJob }, add };
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({ id: "ub-1", number: "01" });
    (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue([]);
    (pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices as jest.Mock).mockResolvedValue(undefined);
    // Sentinela: só chega aqui se a trava de conciliação deixou passar.
    (assertTransshipment as jest.Mock).mockRejectedValue(new Error("SENTINEL_PASSOU"));
  });

  describe("generateBatchFromInvoices", () => {
    it("nota que não é da Bling: não exige avaliação", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([makeInvoice({ integrations_id: "tecinco-int" })]);

      await expect(service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING")).rejects.toThrow(
        "SENTINEL_PASSOU",
      );
      expect(getJob).not.toHaveBeenCalled();
    });

    it("lote de saída com nota Bling: não checa conciliação", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);

      await expect(service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING")).rejects.toThrow(
        "SENTINEL_PASSOU",
      );
    });

    it("nota Bling sem jobId da avaliação: bloqueia antes de assertTransshipment", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);

      await expect(service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING")).rejects.toThrow(
        /Avalie a conciliação dos produtos na Bling/,
      );
      expect(assertTransshipment).not.toHaveBeenCalled();
    });

    it("jobId de outra fila/avaliação: tratado como não encontrado, sem consultar o Redis", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-product-create-x"),
      ).rejects.toThrow(/não encontrada ou expirada/);
      expect(getJob).not.toHaveBeenCalled();
    });

    it("avaliação ainda rodando: bloqueia", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
      getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue("active") });

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-invoice-items-check-1"),
      ).rejects.toThrow(/ainda não terminou/);
    });

    it("avaliação de outras notas: bloqueia pedindo nova avaliação", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
      getJob.mockResolvedValue(completedJob([{ blingId: 999, items: [{ codigo: "A", descricao: "x" }] }]));

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-invoice-items-check-1"),
      ).rejects.toThrow(/não inclui a\(s\) nota\(s\) 438864/);
    });

    it("item sem código na Bling: bloqueia com o link de edição da nota de entrada", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
      getJob.mockResolvedValue(
        completedJob([
          {
            blingId: 26454378751,
            items: [
              { codigo: "04513950000", descricao: "Pneu 225/75R16C" },
              { codigo: "", descricao: "Pneu 185/60R14 82H POWC 2" },
            ],
          },
        ]),
      );

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-invoice-items-check-1"),
      ).rejects.toThrow(
        "nota 438864 (https://www.bling.com.br/notas.entrada.php#edit/26454378751)",
      );
      expect(assertTransshipment).not.toHaveBeenCalled();
    });

    it("todos os itens com código: passa", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
      getJob.mockResolvedValue(
        completedJob([{ blingId: 26454378751, items: [{ codigo: "04513950000", descricao: "Pneu" }] }]),
      );

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-invoice-items-check-1"),
      ).rejects.toThrow("SENTINEL_PASSOU");
    });
  });

  it("trava da Bling vem antes da de não mapeados (item sem código na Bling também vira não mapeado)", async () => {
    (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
    (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue([
      { id: "u-1", invoice_id: "invoice-1", invoice: { number_system: "438864" } },
    ]);

    await expect(service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING")).rejects.toThrow(
      /Avalie a conciliação dos produtos na Bling/,
    );
  });

  it("tudo conciliado na Bling mas reprocesso da nota ainda na fila: pede pra aguardar a sincronização", async () => {
    (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
    getJob.mockImplementation((id: string) =>
      Promise.resolve(
        id === "bling-invoice-resync-26454378751"
          ? { getState: jest.fn().mockResolvedValue("prioritized") }
          : completedJob([{ blingId: 26454378751, items: [{ codigo: "A", descricao: "Pneu" }] }]),
      ),
    );

    await expect(
      service.generateBatchFromInvoices(["invoice-1"], "ub-1", "INCOMING", undefined, "bling-invoice-items-check-1"),
    ).rejects.toThrow("Aguarde a sincronização da(s) nota(s) 438864 entre Bling e Hub");
    expect(assertTransshipment).not.toHaveBeenCalled();
  });

  it("addInvoiceToBatch de entrada: item sem código na Bling bloqueia com o link", async () => {
    (invoiceService.findAll as jest.Mock).mockResolvedValue([blingInvoice()]);
    getJob.mockResolvedValue(
      completedJob([{ blingId: 26454378751, items: [{ codigo: " ", descricao: "Pneu" }] }]),
    );

    await expect(
      service.addInvoiceToBatch(
        ["29260702036483000614550010004388641821277941"],
        "ub-1",
        "INCOMING",
        undefined,
        undefined,
        undefined,
        "bling-invoice-items-check-1",
      ),
    ).rejects.toThrow(/notas\.entrada\.php#edit\/26454378751/);
    expect(assertTransshipment).not.toHaveBeenCalled();
  });

  describe("enqueueBlingReconciliationCheck", () => {
    it("sem nota Bling: não enfileira e devolve jobId null", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([
        { id: "invoice-1", integrations_id: "tecinco-int", number_system: "1" },
      ]);

      await expect(service.enqueueBlingReconciliationCheck({ invoiceIds: ["invoice-1"] })).resolves.toMatchObject({
        jobId: null,
      });
      expect(add).not.toHaveBeenCalled();
    });

    it("nota Bling: enfileira um job com os ids Bling e prioridade de usuário esperando", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([
        { id: "invoice-1", integrations_id: "bling-int", id_system: "26454378751", number_system: "438864" },
      ]);

      const result = await service.enqueueBlingReconciliationCheck({ invoiceIds: ["invoice-1"] });

      expect(result.jobId).toMatch(/^bling-invoice-items-check-/);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "invoice_items_check",
          apiFetch: expect.objectContaining({ blingId: 26454378751, blingIds: [26454378751] }),
        }),
        result.jobId,
        expect.objectContaining({ priority: 1, removeOnComplete: { age: 3600 } }),
      );
    });

    it("reprocesso da nota ainda na fila: não avalia, devolve syncing pro front esperar", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([
        { id: "invoice-1", integrations_id: "bling-int", id_system: "26454378751", number_system: "438864" },
      ]);
      getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue("active") });

      const result = await service.enqueueBlingReconciliationCheck({ invoiceIds: ["invoice-1"] });

      expect(result).toMatchObject({ jobId: null, syncing: true });
      expect(result.message).toMatch(/Aguarde a sincronização da\(s\) nota\(s\) 438864/);
      expect(add).not.toHaveBeenCalled();
    });

    it("nota com não conciliado no hub: manda o id Bling pro job reprocessar se a Bling já estiver conciliada", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([
        { id: "invoice-1", integrations_id: "bling-int", id_system: "111", number_system: "1" },
        { id: "invoice-2", integrations_id: "bling-int", id_system: "222", number_system: "2" },
      ]);
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue([
        { invoice_id: "invoice-1", reason: "Produto não conciliado na Bling" },
        { invoice_id: "invoice-2", reason: "EAN ausente — apenas SKU salvo" },
      ]);

      await service.enqueueBlingReconciliationCheck({ invoiceIds: ["invoice-1", "invoice-2"] });

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          apiFetch: expect.objectContaining({ blingIds: [111, 222], resyncBlingIds: [111] }),
        }),
        expect.any(String),
        expect.any(Object),
      );
    });

    it("nota não encontrada: erro com a chave", async () => {
      (invoiceService.findAll as jest.Mock).mockResolvedValue([]);

      await expect(service.enqueueBlingReconciliationCheck({ invoiceKeys: ["CHAVE-1"] })).rejects.toThrow(
        "Nota(s) não encontrada(s): CHAVE-1",
      );
    });
  });
});
