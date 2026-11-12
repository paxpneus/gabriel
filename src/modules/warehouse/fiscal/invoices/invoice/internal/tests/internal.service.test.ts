// Todas as dependências do service mockadas por factory: nenhuma cadeia real (Redis/BullMQ) é carregada.
jest.mock("../../shared", () => ({
  __esModule: true,
  invoiceCreationService: {
    createWithRelations: jest.fn(),
    ensureUnitBusinessAttributes: jest.fn(),
    addMissingInvoiceItems: jest.fn(),
  },
  invoiceAttributesRepository: { updateWithAttributesForAllUnits: jest.fn() },
  invoiceQueryConfig: { filterableFields: ["invoice_operation_id"] },
}));

jest.mock("../repositories/internal.repository", () => ({
  __esModule: true,
  default: {
    findIdByIdSystem: jest.fn(),
    listInternalInvoices: jest.fn(),
    findExistingInternalNumbers: jest.fn(),
    findInternalNumbersNotCancelledInUnitBusinesses: jest.fn(),
  },
}));

jest.mock("../../../invoice-operation/invoice-operation.repository", () => ({
  __esModule: true,
  default: { findIdByCode: jest.fn() },
}));

jest.mock("../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), update: jest.fn(), bulkDelete: jest.fn(), bulkCreate: jest.fn() },
}));

jest.mock("../../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("../../../../../transporter/transporter.service", () => ({
  __esModule: true,
  default: { resolveTransporter: jest.fn() },
}));

const fakeTransaction = { LOCK: { UPDATE: "UPDATE" } };
jest.mock("../../../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((run: (t: unknown) => unknown) => run(fakeTransaction)) },
}));

jest.mock("../../../../../expedition/batch/batch.service", () => ({
  __esModule: true,
  default: { generateBatchFromInvoices: jest.fn(), finishBatch: jest.fn(), findById: jest.fn() },
}));
jest.mock("../../../../../expedition/batch/batch.model", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../../../expedition/batch-items/batch-items.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../../../expedition/batch-invoice-items/batch-invoice-items.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn(), findPendingByBatchItemId: jest.fn() },
}));
jest.mock("../../../../../expedition/batch-invoices/batch-invoices.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../../../../company/users/user_config/user_config.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("../../../../../expedition/scan-logs/scan-logs.service", () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn(), syncFromScanning: jest.fn() },
}));
jest.mock("../../../../../../inventory/products/services/product.service", () => ({
  __esModule: true,
  default: { findByCode: jest.fn() },
}));

import { invoiceAttributesRepository, invoiceCreationService } from "../../shared";
import expeditionBatchService from "../../../../../expedition/batch/batch.service";
import batchItemsService from "../../../../../expedition/batch-items/batch-items.service";
import batchInvoiceItemsService from "../../../../../expedition/batch-invoice-items/batch-invoice-items.service";
import scanLogsService from "../../../../../expedition/scan-logs/scan-logs.service";
import batchInvoicesService from "../../../../../expedition/batch-invoices/batch-invoices.service";
import userConfigService from "../../../../../../company/users/user_config/user_config.service";
import productService from "../../../../../../inventory/products/services/product.service";
import internalInvoiceRepository from "../repositories/internal.repository";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import unmappedInvoiceProductService from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import storeService from "../../../../../../sales/stores/stores.service";
import transporterService from "../../../../../transporter/transporter.service";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";
import internalInvoiceService, { UpsertInternalInvoiceParams } from "../services/internal.service";

const creation = invoiceCreationService as jest.Mocked<typeof invoiceCreationService>;
const attributes = invoiceAttributesRepository as jest.Mocked<typeof invoiceAttributesRepository>;
const repository = internalInvoiceRepository as jest.Mocked<typeof internalInvoiceRepository>;
const operations = invoiceOperationRepository as jest.Mocked<typeof invoiceOperationRepository>;
const unmapped = unmappedInvoiceProductService as jest.Mocked<typeof unmappedInvoiceProductService>;

const STORE_12 = { cnpj: "02316749001220", name: "PAX LOJA 12" };
const STORE_24 = { cnpj: "02316749002463", name: "PAX LOJA 24" };

// Nota 882 de 12 → 24 como a Tecinco devolve no detalhe da chave composta (só os campos usados).
function buildParams(overrides: Partial<UpsertInternalInvoiceParams> = {}): UpsertInternalInvoiceParams {
  return {
    detail: {
      chave: { nota: 882, serie: "B", seq_cancelamento: "0" },
      cabecalho: { emissao: "2026-10-31", situacao: "A", entrada_saida: "S" },
      totais: { valor_nota: 1554.08, valor_produtos: 1554.08, valor_frete: 0, valor_desconto: 0, valor_ipi: 0 },
      itens: [
        {
          epeit_seq: 1,
          epctb_codigo: "20302",
          produto_nome: "PNEU 185/60R15",
          produto_unidade: "PC",
          epeit_qtdade: 4,
          epeit_vlrunit: 388.52,
          epeit_vlrliquido: 1554.08,
          epeit_percicm: 12,
          epeit_vlricm: 186.49,
        },
      ],
    },
    numero: "882",
    invoiceType: "OUTGOING",
    sender: STORE_12,
    receiver: STORE_24,
    integrationsId: "tecinco-id",
    operationalItems: [
      { product_id: "product-1", quantity_expected: 4, item_number: 1, sku: "20302", gtin: "789", description: "PNEU 185/60R15" },
    ],
    unmappedItems: [],
    cancelled: false,
    ...overrides,
  };
}

describe("InternalInvoiceService.upsertInternalInvoice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    operations.findIdByCode.mockResolvedValue("op-internal");
    (transporterService.resolveTransporter as jest.Mock).mockResolvedValue({ id: "tr-1", cnpj: "0000000", name: "Sem transporte" });
    (storeService.findOne as jest.Mock).mockResolvedValue({ id: "store-outros" });
    creation.createWithRelations.mockResolvedValue({ id: "invoice-1" } as any);
    unmapped.findAll.mockResolvedValue([]);
  });

  it("cria sem XML, com série B, operação interna e itens fiscais do detalhe", async () => {
    repository.findIdByIdSystem.mockResolvedValue(null);

    const id = await internalInvoiceService.upsertInternalInvoice(buildParams());

    expect(id).toBe("invoice-1");
    expect(operations.findIdByCode).toHaveBeenCalledWith(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    expect(transporterService.resolveTransporter).toHaveBeenCalledWith({ document: null, integrationsId: "tecinco-id" });
    const [data, items, options] = creation.createWithRelations.mock.calls[0];
    expect(data).toMatchObject({
      id_system: `TCAR-INTERNAL-${STORE_12.cnpj}-882`,
      xml_key: null,
      xml_path: null,
      danfe_path: null,
      invoice_series: "B",
      invoice_operation_id: "op-internal",
      store_id: "store-outros",
      sender_cnpj: STORE_12.cnpj,
      receiver_cnpj: STORE_24.cnpj,
      customer_document: STORE_24.cnpj,
      transporter_id: "tr-1",
      invoice_value: 1554.08,
      number_system: "882",
    });
    // Data sem hora = meia-noite de Brasília.
    expect((data.emitted_at as Date).toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(items).toEqual([
      expect.objectContaining({
        product_id: "product-1",
        quantity_expected: 4,
        fiscal: expect.objectContaining({ quantity: 4, unit_price: 388.52, total_value: 1554.08, icms_rate: 12, icms_value: 186.49 }),
      }),
    ]);
    expect(options).toEqual({ initialStatus: "OPEN", invoiceType: "OUTGOING" });
    expect(attributes.updateWithAttributesForAllUnits).not.toHaveBeenCalled();
  });

  it("E (destino) e S (origem) da mesma transferência procuram o mesmo id_system", async () => {
    repository.findIdByIdSystem.mockResolvedValue(null);

    await internalInvoiceService.upsertInternalInvoice(buildParams());
    await internalInvoiceService.upsertInternalInvoice(buildParams({ invoiceType: "INCOMING" }));

    const idSystems = repository.findIdByIdSystem.mock.calls.map(([idSystem]) => idSystem);
    expect(idSystems).toEqual([`TCAR-INTERNAL-${STORE_12.cnpj}-882`, `TCAR-INTERNAL-${STORE_12.cnpj}-882`]);
    // Entrada nasce aguardando agendamento (mesma regra do XML).
    expect(creation.createWithRelations.mock.calls[1][2]).toEqual({
      initialStatus: "WAITING_SCHEDULE_SALES",
      invoiceType: "INCOMING",
    });
  });

  it("existente: atualiza dados, garante attributes e itens faltantes, sem recriar nem trocar a loja", async () => {
    repository.findIdByIdSystem.mockResolvedValue({ id: "invoice-1" });

    const id = await internalInvoiceService.upsertInternalInvoice(buildParams({ invoiceType: "INCOMING" }));

    expect(id).toBe("invoice-1");
    expect(creation.createWithRelations).not.toHaveBeenCalled();
    expect(storeService.findOne).not.toHaveBeenCalled();
    const [ids, data] = attributes.updateWithAttributesForAllUnits.mock.calls[0];
    expect(ids).toEqual(["invoice-1"]);
    expect(data).toMatchObject({ invoice_operation_id: "op-internal", invoice_series: "B" });
    expect(data).not.toHaveProperty("store_id");
    expect(data).not.toHaveProperty("id_system");
    expect(creation.ensureUnitBusinessAttributes).toHaveBeenCalledWith("invoice-1", {
      senderCnpj: STORE_12.cnpj,
      receiverCnpj: STORE_24.cnpj,
      initialStatus: "WAITING_SCHEDULE_SALES",
      invoiceType: "INCOMING",
    });
    expect(creation.addMissingInvoiceItems).toHaveBeenCalledWith("invoice-1", expect.any(Array));
  });

  it("cancelada nasce CANCELLED", async () => {
    repository.findIdByIdSystem.mockResolvedValue(null);

    await internalInvoiceService.upsertInternalInvoice(buildParams({ cancelled: true }));

    expect(creation.createWithRelations.mock.calls[0][2]).toEqual({ initialStatus: "CANCELLED", invoiceType: "OUTGOING" });
  });

  it("sem a operação interna no banco não grava a nota", async () => {
    operations.findIdByCode.mockResolvedValue(null);

    await expect(internalInvoiceService.upsertInternalInvoice(buildParams())).rejects.toThrow("seed da m351");
    expect(creation.createWithRelations).not.toHaveBeenCalled();
  });

  it("não mapeados: cria o novo, atualiza o existente e apaga o UNMAPPED que sumiu, sem query por item", async () => {
    repository.findIdByIdSystem.mockResolvedValue({ id: "invoice-1" });
    unmapped.findAll.mockResolvedValue([
      { id: "u-keep", ean: "111", sku: null, status: "UNMAPPED" },
      { id: "u-gone", ean: null, sku: "OLD", status: "UNMAPPED" },
      { id: "u-mapped", ean: null, sku: "DONE", status: "MAPPED" },
    ] as any);

    await internalInvoiceService.upsertInternalInvoice(
      buildParams({
        unmappedItems: [
          { sku: "A", gtin: "111", qty: 2, xProd: "Pneu A", reason: "r", type: "ERROR_CATALOG", external_id: "10" },
          { sku: "NEW", gtin: null, qty: 3.7, xProd: "Pneu novo", reason: "r2" },
        ],
      }),
    );

    expect(unmapped.findAll).toHaveBeenCalledTimes(1);
    expect(unmapped.update).toHaveBeenCalledWith("u-keep", {
      quantity: 2,
      integrations_id: "tecinco-id",
      external_id: "10",
      type: "ERROR_CATALOG",
    });
    expect(unmapped.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ invoice_id: "invoice-1", sku: "NEW", ean: null, quantity: 3, type: "ERROR_INVOICE", status: "UNMAPPED" }),
    ]);
    // Só o UNMAPPED obsoleto sai; o já resolvido manualmente fica.
    expect(unmapped.bulkDelete).toHaveBeenCalledWith({ where: { id: expect.anything() } });
    const deleteWhere = (unmapped.bulkDelete.mock.calls[0][0] as any).where.id;
    expect(Object.getOwnPropertySymbols(deleteWhere).map((symbol) => deleteWhere[symbol])).toEqual([["u-gone"]]);
  });
});

describe("InternalInvoiceService — dedup do sync", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passa a operação interna e o lado da filial pro repository", async () => {
    operations.findIdByCode.mockResolvedValue("op-internal");
    repository.findExistingInternalNumbers.mockResolvedValue(["882"]);

    await expect(internalInvoiceService.findExistingInternalNumbers("E", STORE_24.cnpj, ["882", "883"])).resolves.toEqual(["882"]);
    expect(repository.findExistingInternalNumbers).toHaveBeenCalledWith("op-internal", "E", STORE_24.cnpj, ["882", "883"]);
  });

  it("sem a operação no banco não deduplica (nem consulta)", async () => {
    operations.findIdByCode.mockResolvedValue(null);

    await expect(internalInvoiceService.findExistingInternalNumbers("S", STORE_12.cnpj, ["882"])).resolves.toEqual([]);
    await expect(
      internalInvoiceService.findInternalNumbersNotCancelledInUnitBusinesses("S", STORE_12.cnpj, ["882"], ["12"]),
    ).resolves.toEqual([]);
    expect(repository.findExistingInternalNumbers).not.toHaveBeenCalled();
    expect(repository.findInternalNumbersNotCancelledInUnitBusinesses).not.toHaveBeenCalled();
  });
});

describe("InternalInvoiceService.listInternalInvoices", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lista pela operação interna com o queryConfig da nota", async () => {
    operations.findIdByCode.mockResolvedValue("op-internal");
    repository.listInternalInvoices.mockResolvedValue({ data: [], meta: {} } as any);

    await internalInvoiceService.listInternalInvoices({ page: 1 } as any, "ub-24");

    expect(repository.listInternalInvoices).toHaveBeenCalledWith({ page: 1 }, "ub-24", "op-internal", {
      filterableFields: ["invoice_operation_id"],
    });
  });

  it("sem a operação cadastrada responde erro em vez de listar outra coisa", async () => {
    operations.findIdByCode.mockResolvedValue(null);

    await expect(internalInvoiceService.listInternalInvoices({} as any, "ub-24")).rejects.toThrow("seed da m351");
    expect(repository.listInternalInvoices).not.toHaveBeenCalled();
  });
});

describe("InternalInvoiceService — lote da nota interna", () => {
  const batches = expeditionBatchService as jest.Mocked<typeof expeditionBatchService>;
  const findItem = batchItemsService.findOne as jest.Mock;
  const findInvoiceItems = batchInvoiceItemsService.findAll as jest.Mock;
  const findByCode = productService.findByCode as jest.Mock;
  const bulkCreate = scanLogsService.bulkCreate as jest.Mock;
  const sync = scanLogsService.syncFromScanning as jest.Mock;

  // Lote interno de saída com o produto em 2 notas: bi-1 (4 esperados, 3 lidos) e bi-2 (2 esperados, nada lido).
  function arrangeOutgoingBatch(overrides: Record<string, unknown> = {}) {
    (batches.findById as jest.Mock).mockResolvedValue({
      id: "batch-1",
      unit_business_id: "ub-12",
      type: "OUTGOING",
      status: "OPEN",
      is_internal: true,
      ...overrides,
    });
    findByCode.mockResolvedValue({ product: { id: "product-1" }, matchedCode: "789" });
    findItem.mockResolvedValue({ id: "item-1" });
    findInvoiceItems.mockResolvedValue([
      { expedition_batch_invoice_id: "bi-1", quantity_expected: 4, quantity_read: 3 },
      { expedition_batch_invoice_id: "bi-2", quantity_expected: 2, quantity_read: 0 },
    ]);
  }

  beforeEach(() => jest.clearAllMocks());

  it("generate passa a flag interna pro generate atual", async () => {
    await internalInvoiceService.generateInternalBatch(["inv-1"], "ub-12", "OUTGOING", "REGULAR");

    expect(batches.generateBatchFromInvoices).toHaveBeenCalledWith(["inv-1"], "ub-12", "OUTGOING", "REGULAR", undefined, {
      internal: true,
    });
  });

  it("finalizar passa a flag interna pro finalizar atual", async () => {
    const user = { id: "u-1" };
    await internalInvoiceService.finishInternalBatch("batch-1", "ok", user);

    expect(batches.finishBatch).toHaveBeenCalledWith("batch-1", "ok", user, { internal: true });
  });

  it("scan de saída por EAN reparte entre as notas na ordem e sincroniza cada uma", async () => {
    arrangeOutgoingBatch();

    await internalInvoiceService.scanInternalBatchProduct({
      productCode: "789",
      batchId: "batch-1",
      quantity: 3,
      userId: "u-1",
      type: "OUTGOING",
    });

    expect(findByCode).toHaveBeenCalledWith("789", "ub-12", { transaction: fakeTransaction });
    const logs = bulkCreate.mock.calls[0][0] as any[];
    expect(logs.map((log) => log.expedition_batch_invoices_id)).toEqual(["bi-1", "bi-2", "bi-2"]);
    expect(logs[0]).toMatchObject({ vol_number: "000000", label_full_code: "789", user_id: "u-1", expedition_batch_items_id: "item-1" });
    expect(sync.mock.calls.map(([, , biId, delta]) => [biId, delta])).toEqual([
      ["bi-1", 1],
      ["bi-2", 2],
    ]);
  });

  it("scan de saída acima do restante é recusado sem gravar", async () => {
    arrangeOutgoingBatch();

    await expect(
      internalInvoiceService.scanInternalBatchProduct({ productCode: "789", batchId: "batch-1", quantity: 4, userId: "u-1", type: "OUTGOING" }),
    ).rejects.toThrow("excede o restante a bipar (3)");
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  it("scan de entrada aceita sobra na última nota (mesma regra do scan de entrada atual)", async () => {
    arrangeOutgoingBatch({ type: "INCOMING" });

    await internalInvoiceService.scanInternalBatchProduct({ productCode: "789", batchId: "batch-1", quantity: 5, userId: "u-1", type: "INCOMING" });

    expect(sync.mock.calls.map(([, , biId, delta]) => [biId, delta])).toEqual([
      ["bi-1", 1],
      ["bi-2", 4],
    ]);
  });

  it.each([
    ["lote de NF-e", { is_internal: false }, "Lote não é de nota interna"],
    ["tipo errado", { type: "INCOMING" }, "Lote não é de saída"],
    ["lote finalizado", { status: "FINISHED" }, "Lote já finalizado"],
  ])("scan recusa %s", async (_label, overrides, message) => {
    arrangeOutgoingBatch(overrides);

    await expect(
      internalInvoiceService.scanInternalBatchProduct({ productCode: "789", batchId: "batch-1", userId: "u-1", type: "OUTGOING" }),
    ).rejects.toThrow(message);
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  it("pendências por nota no item do lote", async () => {
    (batchInvoiceItemsService.findPendingByBatchItemId as jest.Mock).mockResolvedValue([
      {
        quantity_expected: 4,
        quantity_read: 1,
        batchItem: { product: { name: "PNEU 185/60R15" } },
        batchInvoice: { invoice: { number_system: "882" } },
      },
    ]);

    await expect(internalInvoiceService.findInternalBatchPending("item-1")).resolves.toEqual([
      { productName: "PNEU 185/60R15", invoiceNumberSystem: "882", pendingQuantity: 3 },
    ]);
  });
});

describe("InternalInvoiceService.adjustInternalBatchQuantity", () => {
  const findBatch = expeditionBatchService.findById as jest.Mock;
  const findItem = batchItemsService.findOne as jest.Mock;
  const findBatchInvoice = batchInvoicesService.findOne as jest.Mock;
  const findInvoiceItem = batchInvoiceItemsService.findOne as jest.Mock;
  const findConfig = userConfigService.findOne as jest.Mock;
  const sync = scanLogsService.syncFromScanning as jest.Mock;

  // Lote interno de saída aberto; a nota tem 4 esperados e 3 lidos do produto.
  function arrange(batch: Record<string, unknown> = {}, userType = "admin") {
    findConfig.mockResolvedValue({ type: userType });
    findBatch.mockResolvedValue({ id: "batch-1", type: "OUTGOING", status: "OPEN", is_internal: true, ...batch });
    findItem.mockResolvedValue({ id: "item-1" });
    findBatchInvoice.mockResolvedValue({ id: "bi-1" });
    findInvoiceItem.mockResolvedValue({ quantity_expected: 4, quantity_read: 3 });
  }
  const call = (quantity: number, type: "OUTGOING" | "INCOMING" = "OUTGOING") =>
    internalInvoiceService.adjustInternalBatchQuantity({ batchId: "batch-1", invoiceId: "inv-1", productId: "p-1", quantity, userId: "u-1", type });

  beforeEach(() => jest.clearAllMocks());

  it.each(["admin", "developer"])("%s ajusta a quantidade lida da nota sem criar scan log", async (userType) => {
    arrange({}, userType);

    await call(-2);

    expect(sync).toHaveBeenCalledWith("batch-1", "item-1", "bi-1", -2, expect.anything());
  });

  it("outro tipo de usuário é recusado", async () => {
    arrange({}, "operator");

    await expect(call(1)).rejects.toThrow("Apenas administradores");
    expect(sync).not.toHaveBeenCalled();
  });

  it.each([0, 1.5])("quantidade %s é inválida", async (quantity) => {
    arrange();

    await expect(call(quantity)).rejects.toThrow("Quantidade inválida");
  });

  it("não deixa a nota abaixo de zero", async () => {
    arrange();

    await expect(call(-4)).rejects.toThrow("maior que o já bipado (3)");
    expect(sync).not.toHaveBeenCalled();
  });

  it("saída não passa do esperado da nota; entrada aceita sobra", async () => {
    arrange();
    await expect(call(2)).rejects.toThrow("excede o restante a bipar (1)");

    arrange({ type: "INCOMING" });
    await call(5, "INCOMING");
    expect(sync).toHaveBeenCalledWith("batch-1", "item-1", "bi-1", 5, expect.anything());
  });

  it.each([
    ["lote de NF-e", { is_internal: false }, "Lote não é de nota interna"],
    ["tipo errado", { type: "INCOMING" }, "Lote não é de saída"],
    ["lote finalizado", { status: "FINISHED" }, "Lote já finalizado"],
  ])("recusa %s", async (_label, batch, message) => {
    arrange(batch);

    await expect(call(1)).rejects.toThrow(message);
    expect(sync).not.toHaveBeenCalled();
  });
});
