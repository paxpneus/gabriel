import { Transaction } from "sequelize";
import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { InvoiceAttributes, InvoiceCreationData } from "../../invoice.types";

// Criação da nota (usada pelo fluxo de criação com relações).
export class InvoiceCreationRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  async createInvoice(
    invoiceData: InvoiceCreationData,
    transaction?: Transaction,
  ): Promise<Invoice> {
    return Invoice.create(invoiceData as InvoiceAttributes, { transaction });
  }
}

export default new InvoiceCreationRepository();
