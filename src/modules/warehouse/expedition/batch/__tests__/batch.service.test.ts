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
  default: {
    findOne: jest.fn(),
    createBatchInvoiceWithItems: jest.fn(),
    findByInvoiceAndUnitBusiness: jest.fn(),
  },
}));

jest.mock("../../../transporter/transporter.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../../../shared/utils/normalizers/batch-nomenclature", () => ({
  __esModule: true,
  setBatchNumber: jest.fn(),
}));

import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import unmappedInvoiceProductService from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import { assertTransshipment } from "../../utils/helpers/transshipment-resolver";
import batchInvoicesService from "../../batch-invoices/batch-invoices.service";
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
    it("nota com unmapped UNMAPPED: bloqueia ANTES de assertTransshipment, com a mensagem e o número da nota", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue({
        id: "invoice-1",
        number_system: "1001",
        items: [{ id: "item-1" }],
        get: () => ({}),
      });
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [{ id: "unmapped-1", invoice_id: "invoice-1" }],
      );

      await expect(
        service.addInvoiceToBatch("29260802036483000614550010004404561245674661", "ub-1", "OUTGOING"),
      ).rejects.toThrow(/Nota\(s\) com produtos não mapeados.*1001/);

      expect(assertTransshipment).not.toHaveBeenCalled();
    });

    it("sem unmapped: não bloqueia — passa da checagem e chega em assertTransshipment", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue({
        id: "invoice-1",
        number_system: "1001",
        items: [{ id: "item-1" }],
        get: () => ({}),
      });
      (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
        [],
      );
      (assertTransshipment as jest.Mock).mockRejectedValue(
        new Error("SENTINEL_PASSOU_DO_UNMAPPED"),
      );

      await expect(
        service.addInvoiceToBatch("29260802036483000614550010004404561245674661", "ub-1", "OUTGOING"),
      ).rejects.toThrow("SENTINEL_PASSOU_DO_UNMAPPED");

      expect(
        unmappedInvoiceProductService.findUnmappedByInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-1"], mockTransaction);
    });
  });
});

describe("ExpeditionBatchService — transbordo (purpose)", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({
      id: "ub-1",
      number: "01",
      transshipment_allowed: true,
    });
    (unmappedInvoiceProductService.findUnmappedByInvoiceIds as jest.Mock).mockResolvedValue(
      [],
    );
  });

  describe("generateBatchFromInvoices", () => {
    it("notas de transbordo (purpose TRANSSHIPMENT em todas): não bloqueia por mistura e segue adiante", async () => {
      const invoice = makeInvoice();
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (assertTransshipment as jest.Mock).mockResolvedValue({
        purpose: "TRANSSHIPMENT",
      });
      // Sentinela: deixa a função "morrer" logo depois do bloco de
      // assertTransshipment/ensureSameBy, num ponto só alcançável se essas
      // checagens passaram.
      (unitBusinessService.findOne as jest.Mock).mockResolvedValueOnce({
        id: "ub-1",
        number: "01",
        transshipment_allowed: true,
      });
      const { setBatchNumber } = jest.requireMock(
        "../../../../../shared/utils/normalizers/batch-nomenclature",
      );
      (setBatchNumber as jest.Mock).mockRejectedValue(
        new Error("SENTINEL_PASSOU_DO_ENSURE_SAME_BY"),
      );

      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING"),
      ).rejects.toThrow("SENTINEL_PASSOU_DO_ENSURE_SAME_BY");
    });

    it("mistura nota de transbordo com nota regular no mesmo lote: bloqueia", async () => {
      const invoiceA = makeInvoice({ id: "invoice-1" });
      const invoiceB = makeInvoice({ id: "invoice-2" });
      (invoiceService.findAll as jest.Mock).mockResolvedValue([
        invoiceA,
        invoiceB,
      ]);
      (assertTransshipment as jest.Mock)
        .mockResolvedValueOnce({ purpose: "TRANSSHIPMENT" })
        .mockResolvedValueOnce({ purpose: "REGULAR" });

      await expect(
        service.generateBatchFromInvoices(
          ["invoice-1", "invoice-2"],
          "ub-1",
          "OUTGOING",
        ),
      ).rejects.toThrow(
        "Não é permitido misturar notas de transbordo com notas regulares no mesmo lote!",
      );
    });

    it("alreadyBatched: busca o lote existente escopado por unitBusinessId e type (não mais um findOne sem escopo)", async () => {
      const invoice = makeInvoice({
        get: () => ({
          id: "invoice-1",
          number_system: "1001",
          transporter_name: "Transportadora X",
          items: [{ id: "item-1" }],
          unitBusinessAttributes: [{ type: "OUTGOING", batch_generated: true }],
        }),
      });
      (invoiceService.findAll as jest.Mock).mockResolvedValue([invoice]);
      (batchInvoicesService.findByInvoiceAndUnitBusiness as jest.Mock).mockResolvedValue(
        { expedition_batch_id: "batch-99" },
      );

      // getFullBatch não é mockado aqui (repository real, model auto-mockado
      // retorna undefined) — só interessa confirmar que o lookup do lote já
      // batchado foi escopado corretamente antes desse ponto.
      await expect(
        service.generateBatchFromInvoices(["invoice-1"], "ub-1", "OUTGOING"),
      ).rejects.toThrow("Lote não encontrado");

      expect(
        batchInvoicesService.findByInvoiceAndUnitBusiness,
      ).toHaveBeenCalledWith(
        "invoice-1",
        "ub-1",
        { type: "OUTGOING" },
        mockTransaction,
      );
    });
  });

  describe("addInvoiceToBatch", () => {
    function mockInvoiceFound() {
      (invoiceService.findOne as jest.Mock).mockResolvedValue({
        id: "invoice-1",
        number_system: "1001",
        items: [{ id: "item-1" }],
        get: () => ({}),
      });
    }

    it("purpose REGULAR (nota comum, mesmo em filial transshipment_allowed): bloqueia qualquer batch invoice já existente, independente de direção — igual hoje", async () => {
      mockInvoiceFound();
      (assertTransshipment as jest.Mock).mockResolvedValue({
        purpose: "REGULAR",
      });
      (batchInvoicesService.findByInvoiceAndUnitBusiness as jest.Mock).mockResolvedValue(
        { expedition_batch_id: "outro-lote" },
      );

      await expect(
        service.addInvoiceToBatch(
          "29260802036483000614550010004404561245674661",
          "ub-1",
          "OUTGOING",
        ),
      ).rejects.toThrow("já pertence a outro lote nesta unidade");

      expect(
        batchInvoicesService.findByInvoiceAndUnitBusiness,
      ).toHaveBeenCalledWith("invoice-1", "ub-1", {}, mockTransaction);
    });

    it("purpose TRANSSHIPMENT: não bloqueia quando só existe a perna oposta (direção diferente)", async () => {
      mockInvoiceFound();
      (assertTransshipment as jest.Mock).mockResolvedValue({
        purpose: "TRANSSHIPMENT",
      });
      (batchInvoicesService.findByInvoiceAndUnitBusiness as jest.Mock).mockResolvedValue(
        null,
      );
      const { setBatchNumber } = jest.requireMock(
        "../../../../../shared/utils/normalizers/batch-nomenclature",
      );
      (setBatchNumber as jest.Mock).mockRejectedValue(
        new Error("SENTINEL_PASSOU_DO_ALREADY_IN_BATCH"),
      );

      await expect(
        service.addInvoiceToBatch(
          "29260802036483000614550010004404561245674661",
          "ub-1",
          "OUTGOING",
        ),
      ).rejects.toThrow("SENTINEL_PASSOU_DO_ALREADY_IN_BATCH");

      expect(
        batchInvoicesService.findByInvoiceAndUnitBusiness,
      ).toHaveBeenCalledWith(
        "invoice-1",
        "ub-1",
        { type: "OUTGOING", purpose: "TRANSSHIPMENT" },
        mockTransaction,
      );
    });

    it("purpose TRANSSHIPMENT: bloqueia duplicata da MESMA direção", async () => {
      mockInvoiceFound();
      (assertTransshipment as jest.Mock).mockResolvedValue({
        purpose: "TRANSSHIPMENT",
      });
      (batchInvoicesService.findByInvoiceAndUnitBusiness as jest.Mock).mockResolvedValue(
        { expedition_batch_id: "lote-outgoing-existente" },
      );

      await expect(
        service.addInvoiceToBatch(
          "29260802036483000614550010004404561245674661",
          "ub-1",
          "OUTGOING",
        ),
      ).rejects.toThrow("já pertence a outro lote nesta unidade");
    });
  });
});
