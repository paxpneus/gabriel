import { Transaction } from "sequelize";
import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import InvoiceUnitBusinessAttributes from "./invoice-unit-business-attributes.model";
import { InvoiceUnitBusinessAttributesCreationAttributes } from "./invoice-unit-business-attributes.types";

// Repository dos attributes da nota por unit business (busca e criação).
export class InvoiceUnitBusinessAttributesRepository extends BaseRepository<InvoiceUnitBusinessAttributes> {
  constructor() {
    super(InvoiceUnitBusinessAttributes);
  }

  // type opcional: a loja de transbordo tem uma linha por type (entrada e expedição); as demais, uma só.
  async findInvoiceAttribute(
    invoiceId: string,
    unitBusinessId: string,
    type?: "INCOMING" | "OUTGOING",
    transaction?: Transaction,
  ): Promise<InvoiceUnitBusinessAttributes | null> {
    return InvoiceUnitBusinessAttributes.findOne({
      where: {
        invoice_id: invoiceId,
        unit_business_id: unitBusinessId,
        ...(type && { type }),
      },
      transaction,
    });
  }

  async createInvoiceAttributes(
    attributes: InvoiceUnitBusinessAttributesCreationAttributes[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceUnitBusinessAttributes.bulkCreate(attributes, { transaction });
  }
}

export default new InvoiceUnitBusinessAttributesRepository();
