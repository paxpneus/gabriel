// Só a parte de nota interna (série B) do sync de notas: tudo que o runner importa e abre infra (Redis/BullMQ/fachada) é mockado por factory.
jest.mock("../../../config/redis", () => ({ __esModule: true, redisConfig: {}, redisClient: { on: jest.fn() } }));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({})),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

jest.mock("../../../modules/handlers/tecinco/queues/tecinco-invoice.queue", () => ({
  __esModule: true,
  TCarInvoiceQueue: class {},
  TCAR_INVOICE_NEW_JOB_NAME: "invoice-new",
  TCAR_INVOICE_UPDATE_JOB_NAME: "invoice-update",
  TCAR_INVOICE_INTERNAL_NEW_JOB_NAME: "invoice-internal-new",
  TCAR_INVOICE_INTERNAL_UPDATE_JOB_NAME: "invoice-internal-update",
  TCAR_INVOICE_NEW_PRIORITY: 2,
  TCAR_INVOICE_UPDATE_PRIORITY: 3,
  TCAR_INVOICE_XML_UNAVAILABLE_FAILURE: "XML indisponível na Tecinco",
}));

const listarNotasFiscaisMock = jest.fn();
jest.mock("../../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service", () => ({
  __esModule: true,
  TECINCO_INTERNAL_INVOICE_SERIES: "B",
  TCarConferenciaEstoqueService: jest.fn().mockImplementation(() => ({ listarNotasFiscais: listarNotasFiscaisMock })),
}));

jest.mock("../../../modules/warehouse/fiscal/invoices/invoice/invoice.model", () => ({
  __esModule: true,
  default: { findAll: jest.fn().mockResolvedValue([]) },
}));

jest.mock("../../../modules/warehouse/fiscal/invoices/invoice", () => ({
  __esModule: true,
  internalInvoiceService: {
    findExistingInternalNumbers: jest.fn(),
    findInternalNumbersNotCancelledInUnitBusinesses: jest.fn(),
  },
  invoiceCancellationService: { findXmlKeysNotCancelledInUnitBusinesses: jest.fn().mockResolvedValue([]) },
}));

jest.mock("../../../modules/handlers/tecinco/queues/helpers/lookup-cache", () => ({
  __esModule: true,
  getCachedUnitBusinessByNumber: jest.fn().mockResolvedValue({ cnpj: "02.316.749/0012-20" }),
}));

jest.mock("../../../modules/handlers/tecinco/service/produtos/produtos.service", () => ({ __esModule: true, TCarProdutoService: jest.fn() }));
jest.mock("../../../modules/handlers/tecinco/service/clientes/clientes.service", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue", () => ({ __esModule: true }));
jest.mock("../../../modules/handlers/tecinco/api/tecinco_api", () => ({ __esModule: true, getTCarIntegration: jest.fn() }));
jest.mock("../../../modules/integrations/integration-mapping/integration-mapping.service", () => ({ __esModule: true, default: {} }));
jest.mock("../dump-tecinco-catalog", () => ({ __esModule: true, fetchTecincoCatalog: jest.fn(), CATALOG_OUTPUT_PATH: "" }));
jest.mock("../paginate-tcar", () => ({ __esModule: true, paginateTCar: jest.fn() }));
jest.mock("../tecinco-duplicate-detection", () => ({ __esModule: true }));
jest.mock("../../../shared/constants/tecinco-units", () => ({ __esModule: true, tecincoUnitBusinessForPopulate: ["12", "24"] }));

import { enqueueInvoiceCancellations, migrateNovasNotasFiscais } from "../tecinco-migration.runner";
import { internalInvoiceService } from "../../../modules/warehouse/fiscal/invoices/invoice";

const BRANCH_CNPJ = "02316749001220";
const findExisting = internalInvoiceService.findExistingInternalNumbers as jest.Mock;
const findNotCancelled = internalInvoiceService.findInternalNumbersNotCancelledInUnitBusinesses as jest.Mock;

// Item da listagem /notas-fiscais da série B (sem chave_nfe).
function internalNote(entradaSaida: "E" | "S", nota: number, extra: Record<string, unknown> = {}) {
  return {
    entrada_saida: entradaSaida,
    chave_nfe: null,
    chave: { nota, serie: "B", cln_codigo: 1, tpneg_codigo: 3, ntz_codigo: 5152, opr_codigo: 0, seq_cancelamento: "0" },
    ...extra,
  };
}

function buildQueue(pendingJobIds: string[] = []) {
  return {
    add: jest.fn().mockResolvedValue({ id: "job" }),
    getPendingJobIds: jest.fn().mockResolvedValue(new Set(pendingJobIds)),
    getFailedJobIdsByReason: jest.fn().mockResolvedValue(new Set()),
  };
}

function runOptions(queue: ReturnType<typeof buildQueue>) {
  return { branchIds: [12], companyId: "default", upsertQueue: queue as any, invoiceQueue: queue as any, dryRun: false };
}

describe("tecinco-migration.runner — nota interna (série B)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    findExisting.mockResolvedValue([]);
    findNotCancelled.mockResolvedValue([]);
  });

  it("novas: lista série B sem modelo 55, pula a com chave, a já gravada e a com job pendente", async () => {
    listarNotasFiscaisMock.mockImplementation(async (_branchId: number, params: any) => {
      if (params.serie !== "B") return { data: [] };
      if (params.entrada_saida === "S" && params.situacao === "A") {
        return { data: [internalNote("S", 882), internalNote("S", 900, { chave_nfe: "3526..." }), internalNote("S", 884)] };
      }
      if (params.entrada_saida === "E" && params.situacao === "N") return { data: [internalNote("E", 883)] };
      return { data: [] };
    });
    findExisting.mockImplementation(async (side: string) => (side === "S" ? ["882"] : []));
    const queue = buildQueue(["invoice-internal-new-12-S-884"]);

    await migrateNovasNotasFiscais(runOptions(queue));

    const internalCalls = listarNotasFiscaisMock.mock.calls.filter(([, params]) => params.serie === "B");
    expect(internalCalls).toHaveLength(4);
    for (const [, params] of internalCalls) {
      expect(params).not.toHaveProperty("modelo_documento");
      expect(params.limit).toBe(300);
    }
    // Dedup por lado com o CNPJ limpo da filial (a nota com chave_nfe nem entra).
    expect(findExisting).toHaveBeenCalledWith("S", BRANCH_CNPJ, ["882", "884"]);
    expect(findExisting).toHaveBeenCalledWith("E", BRANCH_CNPJ, ["883"]);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [payload, jobId, options] = queue.add.mock.calls[0];
    expect(jobId).toBe("invoice-internal-new-12-E-883");
    expect(payload).toMatchObject({
      resource: "invoice_internal",
      branchId: 12,
      data: { numero: 883, entrada_saida: "E", serie: "B", seq_cancelamento: "0", cln_codigo: 1 },
    });
    expect(options).toMatchObject({ priority: 2, name: "invoice-internal-new" });
  });

  it("canceladas: inexistente nasce pelo invoice-internal-new, gravada não cancelada vira update, já cancelada é pulada", async () => {
    listarNotasFiscaisMock.mockImplementation(async (_branchId: number, params: any) => {
      if (params.serie !== "B") return { data: [] };
      return { data: [internalNote("S", 882), internalNote("S", 883), internalNote("E", 884)] };
    });
    findExisting.mockImplementation(async (side: string) => (side === "S" ? ["882", "883"] : []));
    findNotCancelled.mockImplementation(async (side: string) => (side === "S" ? ["882"] : []));
    const queue = buildQueue();

    await enqueueInvoiceCancellations(runOptions(queue));

    const internalListing = listarNotasFiscaisMock.mock.calls.find(([, params]) => params.serie === "B");
    expect(internalListing?.[1]).toMatchObject({ situacao: "C" });
    expect(internalListing?.[1]).not.toHaveProperty("entrada_saida");
    expect(findNotCancelled).toHaveBeenCalledWith("S", BRANCH_CNPJ, ["882", "883"], ["12", "24"]);

    const enqueued = queue.add.mock.calls.map(([, jobId, options]) => [jobId, options.name, options.priority]);
    expect(enqueued).toEqual([
      ["invoice-internal-update-12-S-882", "invoice-internal-update", 3],
      ["invoice-internal-new-12-E-884", "invoice-internal-new", 2],
    ]);
  });
});
