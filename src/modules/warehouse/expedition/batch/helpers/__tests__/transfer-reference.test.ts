jest.mock("../../../../fiscal/invoices/invoice", () => ({
  __esModule: true,
  transferReferenceService: { assertTransferReferences: jest.fn().mockResolvedValue(undefined) },
}));

import { transferReferenceService } from "../../../../fiscal/invoices/invoice";
import { assertAdtBatchTransferReferences } from "../transfer-reference";

const batch = (
  transporterName: string | null,
  invoices: Array<[string, string | null, string | null, string?]>,
) =>
  ({
    transporter: transporterName ? { name: transporterName } : null,
    batchInvoices: invoices.map(([number, invoiceTransporter, reference, correctionLetterPath]) => ({
      invoice_id: `inv-${number}`,
      invoice: {
        number_system: number,
        transporter_name: invoiceTransporter,
        transfer_invoice_reference: reference,
        correction_letter_path: correctionLetterPath ?? null,
      },
    })),
  }) as any;

const closing = (action: string) =>
  `Vincule a nota de transferência (ou anexe a carta de correção da nota, se ela devia ter ido por transportadora) antes de ${action}.`;

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
      "gerar o romaneio",
    );

    expect(transferReferenceService.assertTransferReferences).toHaveBeenCalledWith(
      [
        { invoiceId: "inv-100", invoiceNumber: "100", reference: "REF: 387" },
        { invoiceId: "inv-101", invoiceNumber: "101", reference: null },
      ],
      closing("gerar o romaneio"),
      { checkAlreadyUsed: false },
    );
  });

  it("nota com carta de correção fica fora da checagem; a ação fecha a mensagem", async () => {
    await assertAdtBatchTransferReferences(
      batch("LOGISTICA PAX PNEUS SP - CD 12", [
        ["100", null, null, "temp://abc"],
        ["101", null, "REF: 387"],
      ]),
      "finalizar o lote",
    );

    expect(transferReferenceService.assertTransferReferences).toHaveBeenCalledWith(
      [{ invoiceId: "inv-101", invoiceNumber: "101", reference: "REF: 387" }],
      closing("finalizar o lote"),
      { checkAlreadyUsed: false },
    );
  });

  it("todas as notas com carta de correção → não valida", async () => {
    await assertAdtBatchTransferReferences(
      batch("LOGISTICA PAX PNEUS SP - CD 12", [["100", null, null, "/cartas-correcao/a.pdf"]]),
      "gerar o romaneio",
    );
    expect(transferReferenceService.assertTransferReferences).not.toHaveBeenCalled();
  });

  it.each([["JADLOG"], ["LOGISTICA PAX PNEUS - CD 21"]])("%s → não valida", async (name) => {
    await assertAdtBatchTransferReferences(batch(name, [["100", name, null]]), "gerar o romaneio");
    expect(transferReferenceService.assertTransferReferences).not.toHaveBeenCalled();
  });
});
