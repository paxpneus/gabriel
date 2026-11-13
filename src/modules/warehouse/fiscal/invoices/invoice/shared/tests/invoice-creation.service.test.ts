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

import { InvoiceUnitBusinessAttributesCreationAttributes } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { InvoiceCreationData, ItemWithFiscal } from "../../invoice.types";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

const fakeTransaction = {
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock("../../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn().mockResolvedValue(fakeTransaction),
    where: jest.fn(),
    fn: jest.fn(),
    col: jest.fn(),
    define: jest.fn(() => class { }),
    authenticate: jest.fn(),
    sync: jest.fn(),
    query: jest.fn(),
    close: jest.fn(),
    getQueryInterface: jest.fn(),
    models: {},
    modelManager: { addModel: jest.fn(), getModel: jest.fn() },
    literal: jest.fn((value: string) => value),
  },
}));

jest.mock("../repositories/invoice-creation.repository", () => ({
  __esModule: true,
  default: { createInvoice: jest.fn() },
}));

jest.mock("../repositories/invoice-attributes.repository", () => ({
  __esModule: true,
  default: { findUnitBusinessesByCnpj: jest.fn() },
}));

jest.mock("../../../invoice-items/invoice-items.repository", () => ({
  __esModule: true,
  default: { createInvoiceItems: jest.fn(), findByInvoiceId: jest.fn() },
}));

jest.mock("../../../invoice-fiscal-item/invoice-fiscal-item.repository", () => ({
  __esModule: true,
  default: { createInvoiceFiscalItems: jest.fn(), findByInvoiceId: jest.fn() },
}));

jest.mock("../../../invoice-unit-business-attributes/invoice-unit-business-attributes.repository", () => ({
  __esModule: true,
  default: { createInvoiceAttributes: jest.fn(), findInvoiceAttribute: jest.fn() },
}));

jest.mock("../../../invoice-operation/invoice-operation.repository", () => ({
  __esModule: true,
  default: { findIdByCode: jest.fn() },
}));

jest.mock("../../../../../../company/events/event/event.service", () => ({
  __esModule: true,
  default: {
    notifyByRoles: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    notifyByRoles: jest.fn().mockResolvedValue(undefined),
  },
}));

import sequelize from "../../../../../../../config/sequelize";
import invoiceCreationService from "../services/invoice-creation.service";
import creationRepoDefault from "../repositories/invoice-creation.repository";
import attributesRepoDefault from "../repositories/invoice-attributes.repository";
import itemsRepoDefault from "../../../invoice-items/invoice-items.repository";
import fiscalItemRepoDefault from "../../../invoice-fiscal-item/invoice-fiscal-item.repository";
import ubAttrRepoDefault from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.repository";
import operationRepoDefault from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";

const creationRepo = creationRepoDefault as unknown as { createInvoice: jest.Mock };
const attributesRepo = attributesRepoDefault as unknown as { findUnitBusinessesByCnpj: jest.Mock };
const itemsRepo = itemsRepoDefault as unknown as { createInvoiceItems: jest.Mock; findByInvoiceId: jest.Mock };
const fiscalItemRepo = fiscalItemRepoDefault as unknown as { createInvoiceFiscalItems: jest.Mock; findByInvoiceId: jest.Mock };
const ubAttrRepo = ubAttrRepoDefault as unknown as { createInvoiceAttributes: jest.Mock; findInvoiceAttribute: jest.Mock };
const operationRepo = operationRepoDefault as unknown as { findIdByCode: jest.Mock };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UNIT_A = "unit-business-a"; // ex: matriz — sempre unit business conhecida
const UNIT_B = "unit-business-b"; // ex: filial — também unit business conhecida
const EXTERNAL_CNPJ = "11222333000144"; // cliente/fornecedor externo, nunca é unit business


const baseInvoiceData: InvoiceCreationData = {
  sender_cnpj: "",
  receiver_cnpj: "",
} as InvoiceCreationData;

const items: ItemWithFiscal[] = [
  { product_id: "prod-1", quantity_expected: 2, fiscal: undefined },
];

// Extrai as attributes que foram efetivamente passadas pro bulkCreate,
// pra não depender de mockar retorno de createInvoice em cada teste.
const getCreatedAttributes = ():
  | InvoiceUnitBusinessAttributesCreationAttributes[]
  | undefined => ubAttrRepo.createInvoiceAttributes.mock.calls[0]?.[0];

beforeEach(() => {
  jest.clearAllMocks();

  (sequelize.transaction as jest.Mock)
    .mockResolvedValue(fakeTransaction);

  creationRepo.createInvoice.mockResolvedValue({ id: "invoice-1" });
  itemsRepo.createInvoiceItems.mockResolvedValue(undefined);
  fiscalItemRepo.createInvoiceFiscalItems.mockResolvedValue(undefined);
  ubAttrRepo.createInvoiceAttributes.mockResolvedValue(undefined);
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("InvoiceCreationService.createWithRelations — resolução de type por cnpj", () => {
  describe("caso 1: transferência interna (sender e receiver são unit business conhecidas)", () => {
    it("cria dois attributes: sender OUTGOING/OPEN e receiver INCOMING/initialStatus, ignorando invoiceType", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_A, cnpj: "sender-cnpj" },
        { id: UNIT_B, cnpj: "receiver-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: "receiver-cnpj" },
        items,
        { initialStatus: "WAITING_SCHEDULE_SALES", invoiceType: "INCOMING" }, // mesmo passando invoiceType, deve ser ignorado quando os dois lados batem
      );

      const attrs = getCreatedAttributes();
      expect(attrs).toHaveLength(2);
      expect(attrs).toContainEqual(
        expect.objectContaining({
          unit_business_id: UNIT_A,
          type: "OUTGOING",
          status: "OPEN",
        }),
      );
      expect(attrs).toContainEqual(
        expect.objectContaining({
          unit_business_id: UNIT_B,
          type: "INCOMING",
          status: "WAITING_SCHEDULE_SALES",
        }),
      );
    });
  });

  describe("caso 2: só sender é unit business conhecida (nota de saída normal)", () => {
    it("sem invoiceType, assume OUTGOING por padrão (comportamento normal)", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_A, cnpj: "sender-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
        items,
      );

      const attrs = getCreatedAttributes();
      expect(attrs).toHaveLength(1);
      expect(attrs![0]).toMatchObject({
        unit_business_id: UNIT_A,
        type: "OUTGOING",
        status: "OPEN",
      });
    });

    it("com invoiceType=INCOMING (nota de retorno), grava INCOMING mesmo sendo o sender — é o bug original que estamos corrigindo", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_A, cnpj: "sender-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
        items,
        { invoiceType: "INCOMING" },
      );

      const attrs = getCreatedAttributes();
      expect(attrs).toHaveLength(1);
      expect(attrs![0]).toMatchObject({
        unit_business_id: UNIT_A,
        type: "INCOMING", // nota de retorno: mesmo sendo sender, o Bling diz que é entrada
        status: "OPEN",
      });
    });
  });

  describe("caso 3: só receiver é unit business conhecida (nota de entrada normal)", () => {
    it("sem invoiceType, assume INCOMING por padrão", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_B, cnpj: "receiver-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "receiver-cnpj" },
        items,
        { initialStatus: "WAITING_SCHEDULE_SALES" },
      );

      const attrs = getCreatedAttributes();
      expect(attrs).toHaveLength(1);
      expect(attrs![0]).toMatchObject({
        unit_business_id: UNIT_B,
        type: "INCOMING",
        status: "WAITING_SCHEDULE_SALES",
      });
    });

    it("com invoiceType=OUTGOING (caso simétrico ao de retorno, do lado do destinatário), respeita o tipo vindo da fonte", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_B, cnpj: "receiver-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "receiver-cnpj" },
        items,
        { invoiceType: "OUTGOING" },
      );

      const attrs = getCreatedAttributes();
      expect(attrs![0]).toMatchObject({
        unit_business_id: UNIT_B,
        type: "OUTGOING",
      });
    });
  });

  describe("caso 4: nem sender nem receiver são unit business conhecidas", () => {
    it("não cria nenhum attribute e não chama createInvoiceAttributes", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro-externo" },
        items,
      );

      expect(ubAttrRepo.createInvoiceAttributes).not.toHaveBeenCalled();
    });
  });

  describe("deduplicação de items", () => {
    it("soma quantity_expected de items com mesmo product_id antes de criar", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
        { id: UNIT_A, cnpj: "sender-cnpj" },
      ]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: "sender-cnpj", receiver_cnpj: EXTERNAL_CNPJ },
        [
          { product_id: "prod-1", quantity_expected: 2.4, fiscal: undefined },
          { product_id: "prod-1", quantity_expected: 1.4, fiscal: undefined },
          { product_id: "prod-2", quantity_expected: 5, fiscal: undefined },
        ],
      );

      const createdItems = itemsRepo.createInvoiceItems.mock.calls[0][0];
      expect(createdItems).toHaveLength(2);
      const prod1 = createdItems.find((i: any) => i.product_id === "prod-1");
      // Math.trunc(2.4 + 1.4) = Math.trunc(3.8) = 3
      expect(prod1.quantity_expected).toBe(3);
    });
  });

  describe("transação", () => {
    it("usa transação externa quando fornecida e não faz commit/rollback próprio", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([]);
      const externalTx = { commit: jest.fn(), rollback: jest.fn() };

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
        items,
        { transaction: externalTx as any },
      );

      expect(externalTx.commit).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it("cria e comita própria transação quando nenhuma é fornecida", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([]);

      await invoiceCreationService.createWithRelations(
        { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
        items,
      );

      expect(fakeTransaction.commit).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.rollback).not.toHaveBeenCalled();
    });

    it("faz rollback da própria transação se algo falhar, e propaga o erro", async () => {
      attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([]);
      creationRepo.createInvoice.mockRejectedValue(new Error("db error"));

      await expect(
        invoiceCreationService.createWithRelations(
          { ...baseInvoiceData, sender_cnpj: EXTERNAL_CNPJ, receiver_cnpj: "outro" },
          items,
        ),
      ).rejects.toThrow("db error");

      expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.commit).not.toHaveBeenCalled();
    });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INVOICE_ID = "invoice-1";

const makeItem = (
  overrides: Partial<ItemWithFiscal> = {},
): ItemWithFiscal => ({
  product_id: "prod-1",
  quantity_expected: 2,
  fiscal: undefined,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();

  (sequelize.transaction as jest.Mock).mockResolvedValue(fakeTransaction);
  (itemsRepo.findByInvoiceId as jest.Mock).mockResolvedValue([]);
  (fiscalItemRepo.findByInvoiceId as jest.Mock).mockResolvedValue([]);
  itemsRepo.createInvoiceItems.mockResolvedValue(undefined);
  fiscalItemRepo.createInvoiceFiscalItems.mockResolvedValue(undefined);
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("InvoiceCreationService.addMissingInvoiceItems", () => {
  it("retorna [] e não toca no banco quando items está vazio", async () => {
    const result = await invoiceCreationService.addMissingInvoiceItems(
      INVOICE_ID,
      [],
    );

    expect(result).toEqual([]);
    expect(itemsRepo.findByInvoiceId).not.toHaveBeenCalled();
    expect(itemsRepo.createInvoiceItems).not.toHaveBeenCalled();
  });

  it("cria só os itens cujo product_id ainda não tem InvoiceItems pra essa invoice", async () => {
    (itemsRepo.findByInvoiceId as jest.Mock).mockResolvedValue([
      { product_id: "prod-1" },
    ]);

    const result = await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1" }), // já existe — deve ser ignorado
      makeItem({ product_id: "prod-2" }), // novo — deve ser criado
    ]);

    expect(result).toEqual(["prod-2"]);
    const createdItems = itemsRepo.createInvoiceItems.mock.calls[0][0];
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]).toMatchObject({
      product_id: "prod-2",
      invoice_id: INVOICE_ID,
    });
  });

  it("ignora product_id que já tem InvoiceFiscalItem mesmo sem InvoiceItems (evita estourar a unique constraint)", async () => {
    (fiscalItemRepo.findByInvoiceId as jest.Mock).mockResolvedValue([
      { product_id: "prod-1" },
    ]);

    const result = await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1" }), // só tem fiscal item — deve ser ignorado
      makeItem({ product_id: "prod-2" }), // novo — deve ser criado
    ]);

    expect(result).toEqual(["prod-2"]);
    const createdItems = itemsRepo.createInvoiceItems.mock.calls[0][0];
    expect(createdItems).toHaveLength(1);
    expect(createdItems[0]).toMatchObject({ product_id: "prod-2" });
  });

  it("quando todos os itens já existem, não chama createInvoiceItems/createInvoiceFiscalItems e retorna []", async () => {
    (itemsRepo.findByInvoiceId as jest.Mock).mockResolvedValue([
      { product_id: "prod-1" },
    ]);

    const result = await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1" }),
    ]);

    expect(result).toEqual([]);
    expect(itemsRepo.createInvoiceItems).not.toHaveBeenCalled();
    expect(fiscalItemRepo.createInvoiceFiscalItems).not.toHaveBeenCalled();
  });

  it("deduplica itens novos com mesmo product_id somando quantity_expected", async () => {
    const result = await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1", quantity_expected: 2.4 }),
      makeItem({ product_id: "prod-1", quantity_expected: 1.4 }),
    ]);

    expect(result).toEqual(["prod-1"]);
    const createdItems = itemsRepo.createInvoiceItems.mock.calls[0][0];
    expect(createdItems).toHaveLength(1);
    // Math.trunc(2.4 + 1.4) = Math.trunc(3.8) = 3
    expect(createdItems[0].quantity_expected).toBe(3);
  });

  it("só cria InvoiceFiscalItem pros itens que trazem fiscal", async () => {
    await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
      makeItem({ product_id: "prod-1", fiscal: undefined }),
      makeItem({
        product_id: "prod-2",
        fiscal: { product_id: "prod-2", item_number: 1 } as any,
      }),
    ]);

    const fiscalItems = fiscalItemRepo.createInvoiceFiscalItems.mock.calls[0][0];
    expect(fiscalItems).toHaveLength(1);
    expect(fiscalItems[0]).toMatchObject({
      product_id: "prod-2",
      invoice_id: INVOICE_ID,
    });
  });

  describe("transação", () => {
    it("usa transação externa quando fornecida e não faz commit/rollback próprio", async () => {
      const externalTx = { commit: jest.fn(), rollback: jest.fn() };

      await invoiceCreationService.addMissingInvoiceItems(
        INVOICE_ID,
        [makeItem({ product_id: "prod-2" })],
        externalTx as any,
      );

      expect(externalTx.commit).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it("cria e comita própria transação quando nenhuma é fornecida", async () => {
      await invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
        makeItem({ product_id: "prod-2" }),
      ]);

      expect(fakeTransaction.commit).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.rollback).not.toHaveBeenCalled();
    });

    it("faz rollback da própria transação se algo falhar, e propaga o erro", async () => {
      itemsRepo.createInvoiceItems.mockRejectedValue(new Error("db error"));

      await expect(
        invoiceCreationService.addMissingInvoiceItems(INVOICE_ID, [
          makeItem({ product_id: "prod-2" }),
        ]),
      ).rejects.toThrow("db error");

      expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
      expect(fakeTransaction.commit).not.toHaveBeenCalled();
    });
  });
});


describe("InvoiceCreationService.ensureUnitBusinessAttributes", () => {
  it("nota provisória enriquecida (sender E receiver resolvem pra unit business conhecida): cria os dois attributes, sender OUTGOING/OPEN e receiver INCOMING/initialStatus", async () => {
    (attributesRepo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([
      { id: "ub-sender", cnpj: "sender-cnpj" },
      { id: "ub-receiver", cnpj: "receiver-cnpj" },
    ]);
    (ubAttrRepo.findInvoiceAttribute as jest.Mock).mockResolvedValue(null);

    await invoiceCreationService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "sender-cnpj",
      receiverCnpj: "receiver-cnpj",
      initialStatus: "WAITING_SCHEDULE_SALES",
    });

    expect(ubAttrRepo.createInvoiceAttributes).toHaveBeenCalledWith(
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

  it("sender e receiver na MESMA unit business (mesmo CNPJ): cria um attribute só, sem violar unique (invoice_id, unit_business_id)", async () => {
    (attributesRepo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([
      { id: "ub-same", cnpj: "same-cnpj" },
    ]);
    (ubAttrRepo.findInvoiceAttribute as jest.Mock).mockResolvedValue(null);

    await invoiceCreationService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "same-cnpj",
      receiverCnpj: "same-cnpj",
    });

    expect(ubAttrRepo.createInvoiceAttributes).toHaveBeenCalledWith(
      [
        {
          invoice_id: "invoice-1",
          unit_business_id: "ub-same",
          type: "OUTGOING",
          status: "OPEN",
          batch_generated: false,
        },
      ],
      undefined,
    );
  });

  it("attribute já existe pro lado resolvido: não duplica (idempotente)", async () => {
    (attributesRepo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([
      { id: "ub-sender", cnpj: "sender-cnpj" },
    ]);
    (ubAttrRepo.findInvoiceAttribute as jest.Mock).mockResolvedValue({
      id: "existing-attr",
    });

    await invoiceCreationService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "sender-cnpj",
      invoiceType: "OUTGOING",
    });

    expect(ubAttrRepo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("nenhum dos dois lados resolve pra unit business conhecida: não cria nada", async () => {
    (attributesRepo.findUnitBusinessesByCnpj as jest.Mock).mockResolvedValue([]);

    await invoiceCreationService.ensureUnitBusinessAttributes("invoice-1", {
      senderCnpj: "cnpj-desconhecido",
      receiverCnpj: "outro-cnpj-desconhecido",
    });

    expect(ubAttrRepo.findInvoiceAttribute).not.toHaveBeenCalled();
    expect(ubAttrRepo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("sem CNPJ nenhum informado: nem consulta o banco", async () => {
    await invoiceCreationService.ensureUnitBusinessAttributes("invoice-1", {});

    expect(attributesRepo.findUnitBusinessesByCnpj).not.toHaveBeenCalled();
    expect(ubAttrRepo.createInvoiceAttributes).not.toHaveBeenCalled();
  });
});

describe("InvoiceCreationService.resolveInvoiceOperationId", () => {
  const SENDER = "12345678000190";
  const RECEIVER = "98765432000110";

  beforeEach(() => {
    operationRepo.findIdByCode.mockImplementation(async (code: string) => `op-${code}`);
  });

  it("emitente e destinatário unit business (CNPJ com máscara) = transferência", async () => {
    attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([
      { id: UNIT_A, cnpj: SENDER },
      { id: UNIT_B, cnpj: RECEIVER },
    ]);

    const id = await invoiceCreationService.resolveInvoiceOperationId({
      senderCnpj: "12.345.678/0001-90",
      receiverCnpj: RECEIVER,
      direction: "OUTGOING",
      isReturn: false,
      isInternal: false,
    });

    expect(attributesRepo.findUnitBusinessesByCnpj).toHaveBeenCalledWith([SENDER, RECEIVER], undefined);
    expect(id).toBe(`op-${INVOICE_OPERATION_CODES.TRANSFER}`);
  });

  it("só emitente unit business + saída = venda", async () => {
    attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([{ id: UNIT_A, cnpj: SENDER }]);

    const id = await invoiceCreationService.resolveInvoiceOperationId({
      senderCnpj: SENDER,
      receiverCnpj: EXTERNAL_CNPJ,
      direction: "OUTGOING",
      isReturn: false,
      isInternal: false,
    });

    expect(id).toBe(`op-${INVOICE_OPERATION_CODES.SALE}`);
  });

  it("sem CNPJ nenhum não consulta unit business e cai em compra", async () => {
    const id = await invoiceCreationService.resolveInvoiceOperationId({
      senderCnpj: "",
      receiverCnpj: null,
      direction: null,
      isReturn: false,
      isInternal: false,
    });

    expect(attributesRepo.findUnitBusinessesByCnpj).not.toHaveBeenCalled();
    expect(id).toBe(`op-${INVOICE_OPERATION_CODES.PURCHASE}`);
  });

  it("code fora da tabela (seed não rodado) = null", async () => {
    attributesRepo.findUnitBusinessesByCnpj.mockResolvedValue([]);
    operationRepo.findIdByCode.mockResolvedValue(null);

    const id = await invoiceCreationService.resolveInvoiceOperationId({
      senderCnpj: SENDER,
      receiverCnpj: RECEIVER,
      direction: "OUTGOING",
      isReturn: true,
      isInternal: false,
    });

    expect(operationRepo.findIdByCode).toHaveBeenCalledWith(INVOICE_OPERATION_CODES.RETURN);
    expect(id).toBeNull();
  });
});
