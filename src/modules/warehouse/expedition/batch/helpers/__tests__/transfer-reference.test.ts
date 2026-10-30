jest.mock("../../../../fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { assertTransferReferences: jest.fn().mockResolvedValue(undefined) },
}));

import invoiceService from "../../../../fiscal/invoices/invoice/invoice.service";
import { assertAdtBatchTransferReferences } from "../transfer-reference";

const batch = (transporterName: string | null, invoices: Array<[string, string | null, string | null]>) =>
  ({
    transporter: transporterName ? { name: transporterName } : null,
    batchInvoices: invoices.map(([number, invoiceTransporter, reference]) => ({
      invoice_id: `inv-${number}`,
      invoice: { number_system: number, transporter_name: invoiceTransporter, transfer_invoice_reference: reference },
    })),
  }) as any;

describe("assertAdtBatchTransferReferences", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["transportadora do lote", "LOGISTICA PAX PNEUS SP - CD 12", null],
    ["transportadora de uma nota", null, "LOGISTICA PAX PNEUS PR - CD 17"],
  ])("CD 12/17 pela %s → valida existência da transferência de todas as notas (sem checar se já é de outra)", async (_case, batchTransporter, invoiceTransporter) => {
    await assertAdtBatchTransferReferences(
      batch(batchTransporter, [
        ["100", invoiceTransporter, "REF: 387"],
        ["101", null, null],
      ]),
    );

    expect(invoiceService.assertTransferReferences).toHaveBeenCalledWith(
      [
        { invoiceId: "inv-100", invoiceNumber: "100", reference: "REF: 387" },
        { invoiceId: "inv-101", invoiceNumber: "101", reference: null },
      ],
      "Vincule a nota de transferência antes de gerar o romaneio.",
      { checkAlreadyUsed: false },
    );
  });

  it.each([["JADLOG"], ["LOGISTICA PAX PNEUS - CD 21"]])("%s → não valida", async (name) => {
    await assertAdtBatchTransferReferences(batch(name, [["100", name, null]]));
    expect(invoiceService.assertTransferReferences).not.toHaveBeenCalled();
  });
});
