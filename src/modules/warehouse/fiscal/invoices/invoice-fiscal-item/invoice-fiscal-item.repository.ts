import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import InvoiceFiscalItem from "./invoice-fiscal-item.model";
import {
  InvoiceFiscalItemAttributes,
  InvoiceFiscalItemCreationAttributes,
} from "./invoice-fiscal-item.types";

// Repository dos itens fiscais da nota (criação em lote e busca por nota/produtos).
export class InvoiceFiscalItemRepository extends BaseRepository<InvoiceFiscalItem> {
  constructor() {
    super(InvoiceFiscalItem);
  }

  async createInvoiceFiscalItems(
    items: InvoiceFiscalItemCreationAttributes[],
    transaction?: Transaction,
  ): Promise<void> {
    await InvoiceFiscalItem.bulkCreate(items as InvoiceFiscalItemAttributes[], {
      transaction,
    });
  }

  // Itens fiscais da nota que já existem pra esses produtos (usado pelo reprocesso de itens faltantes).
  async findByInvoiceId(
    invoiceId: string,
    productIds: string[],
    transaction?: Transaction,
  ): Promise<InvoiceFiscalItem[]> {
    return InvoiceFiscalItem.findAll({
      where: { invoice_id: invoiceId, product_id: { [Op.in]: productIds } },
      transaction,
    });
  }
}

export default new InvoiceFiscalItemRepository();
