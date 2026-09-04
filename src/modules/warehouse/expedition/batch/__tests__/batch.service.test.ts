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

import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import unmappedInvoiceProductService from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import { assertTransshipment } from "../../utils/helpers/transshipment-resolver";
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
