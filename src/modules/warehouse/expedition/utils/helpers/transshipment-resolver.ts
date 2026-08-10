import { Transaction } from "sequelize";
import { cleanDocument } from "../../../../../shared/utils/normalizers/document";
import InvoiceUnitBusinessAttributes from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import {
  InvoiceUnitBusinessAttributesCreationAttributes,
  InvoiceUnitBusinessAttributesStatus,
} from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
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
): Promise<void> {
  if (!unitBusiness) return;

  if (!invoice.sender_cnpj || !invoice.receiver_cnpj) {
    throw new Error(
      "Cnpj emitente ou destinatário não encontrados pela nota fiscal!",
    );
  }

  const unitCnpj = cleanDocument(unitBusiness.cnpj);
  const senderCnpj = cleanDocument(invoice.sender_cnpj);
  const receiverCnpj = cleanDocument(invoice.receiver_cnpj);

  const isSender = senderCnpj === unitCnpj;
  const isReceiver = receiverCnpj === unitCnpj;

  if (!unitBusiness.transshipment_allowed && !isSender && !isReceiver) {
    throw new Error(
      "Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio",
    );
  }

  // ─── Garante o invoice unit business attribute ──────────────────────────
  const type = "INCOMING"
  const status = "OPEN"

  let unitBusinessId

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
    unitBusinessId
  );

  if (existing) return;

  await invoiceRepository.createInvoiceAttributes(
    [
      {
        invoice_id: invoice.id,
        unit_business_id: unitBusinessId,
        type,
        status,
        batch_generated: false,
      },
    ],
  );
}