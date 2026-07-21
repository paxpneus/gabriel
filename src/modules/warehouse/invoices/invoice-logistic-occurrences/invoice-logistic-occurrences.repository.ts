import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Transporter from "../../transporter/transporter.model";
import Invoice from "../invoice/invoice.model";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";
import { InvoiceLogisticOcurrencesCreationAttributesAttributes } from "./invoice-logistic-occurrences.types";

export class InvoiceLogisticOccurrencesRepository extends BaseRepository<InvoiceLogisticOccurrences> {
  constructor() {
    super(InvoiceLogisticOccurrences);
  }

  async findExistingCodes(invoiceId: string): Promise<Set<string>> {
    const rows = await InvoiceLogisticOccurrences.findAll({
      where: { invoice_id: invoiceId },
      attributes: ["occurrency_code"],
    });
    return new Set(rows.map((r) => r.occurrency_code));
  }

  async bulkCreateOccurrences(
    items: InvoiceLogisticOcurrencesCreationAttributesAttributes[],
  ): Promise<void> {
    if (!items.length) return;
    await InvoiceLogisticOccurrences.bulkCreate(items as any);
  }

  async findPendingWithInvoiceAndTransporter(): Promise<InvoiceLogisticOccurrences[]> {
  return InvoiceLogisticOccurrences.findAll({
    where: { status: "PENDING" },
    include: [
      {
        model: Invoice,
        as: 'invoice',
        required: true,
        include: [
          {
            model: Transporter,
            as: 'transporter',
            required: true,
          },
        ],
      },
    ],
    order: [["invoice_id", "ASC"]],
  });
}
}

export default new InvoiceLogisticOccurrencesRepository();