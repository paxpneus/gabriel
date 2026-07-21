import BaseRepository from "../../../../shared/utils/base-models/base-repository";
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
}

export default new InvoiceLogisticOccurrencesRepository();