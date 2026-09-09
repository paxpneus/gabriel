import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import InvoiceUnitBusinessAttributes from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { resolveInvoicePurposeForUnitBusiness } from "../../../fiscal/invoices/invoice/helpers/transshipment-context";
import invoiceRepository from "../../../fiscal/invoices/invoice/invoice.repository";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";

export async function assertTransshipment(
  invoice: {
    id: string;
    sender_cnpj: string | null;
    receiver_cnpj: string | null;
  },
  unitBusiness: {
    id?: string;
    cnpj: string;
    transshipment_allowed?: boolean;
  } | null,
  type: "INCOMING" | "OUTGOING",
): Promise<InvoiceUnitBusinessAttributes | null> {
  if (!unitBusiness) return null;

  if (!invoice.sender_cnpj || !invoice.receiver_cnpj) {
    throw new Error(
      "Cnpj emitente ou destinatário não encontrados pela nota fiscal!",
    );
  }

  const { eligible, purpose } = resolveInvoicePurposeForUnitBusiness(
    unitBusiness,
    invoice,
  );

  if (!eligible) {
    throw new Error(
      "Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio",
    );
  }

  // ─── Garante o invoice unit business attribute ──────────────────────────
  const status = "OPEN";

  let unitBusinessId;

  if (!unitBusiness.id) {
    const foundUnit = await unitBusinessService.findOne({
    where: {
      cnpj: unitBusiness.cnpj
    }
  })

  unitBusinessId = foundUnit!.id
  } else {
    unitBusinessId = unitBusiness.id
  }


  const existing = await invoiceRepository.findInvoiceAttribute(
    invoice.id,
    unitBusinessId,
    type,
  );

  if (existing) return existing;

  const [created] = await invoiceRepository.createInvoiceAttributes([
    {
      invoice_id: invoice.id,
      unit_business_id: unitBusinessId,
      type,
      status,
      batch_generated: false,
      purpose,
    },
  ]);

  return created;
}