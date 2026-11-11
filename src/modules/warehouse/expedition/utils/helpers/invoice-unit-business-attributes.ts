import { Transaction } from "sequelize";
import InvoiceUnitBusinessAttributes from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { InvoiceUnitBusinessAttributesCreationAttributes, InvoiceUnitBusinessAttributesStatus } from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import invoiceUnitBusinessAttributesRepository from "../../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.repository";

export async function ensureInvoiceUnitBusinessAttributes(
  invoice: { id: string },
  unitBusiness: { id: string },
  type: "INCOMING" | "OUTGOING",
  status: InvoiceUnitBusinessAttributesStatus,
): Promise<void> {
  const existing = await invoiceUnitBusinessAttributesRepository.findInvoiceAttribute(
    invoice.id,
    unitBusiness.id,
  );

  if (existing) return;

  await invoiceUnitBusinessAttributesRepository.createInvoiceAttributes(
    [
      {
        invoice_id: invoice.id,
        unit_business_id: unitBusiness.id,
        type,
        status,
        batch_generated: false,
      },
    ],
  );
}