import { Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";
import Invoice from "../../entrance/invoice/invoice.model";
import ExpeditionBatch from "../batch/batch.model";
import ExpeditionBatchItems from "./batch-items.model";
import expeditionBatchItemsRepository, {
  ExpeditionBatchItemsRepository,
} from "./batch-items.repository";

export class ExpeditionBatchItemsService extends BaseService<
  ExpeditionBatchItems,
  ExpeditionBatchItemsRepository
> {
  constructor() {
    super(expeditionBatchItemsRepository);
  }

  async updateBatchItemAndBatch(
  batchItemId: string,
  invoiceId: string,
  productId: string,
  transaction: Transaction,
): Promise<void> {
  await ExpeditionBatchItems.increment("quantity_scanned", {
    by: 1,
    where: { id: batchItemId },
    transaction,
  });

  const expeditionItem = await ExpeditionBatchItems.findByPk(batchItemId, {
    attributes: ["expedition_batch_id"],
    transaction,
  });

  if (!expeditionItem) throw Error("Item do lote não encontrado!");

  await ExpeditionBatch.increment("total_volumes", {
    by: 1,
    where: { id: expeditionItem.expedition_batch_id },
    transaction,
  });

  await InvoiceItems.increment("quantity_received", {
    by: 1,
    where: {
      invoice_id: invoiceId,
      product_id: productId,
    },
    transaction,
  });
}
}

export default new ExpeditionBatchItemsService();
