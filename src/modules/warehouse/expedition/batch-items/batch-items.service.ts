import { Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import InvoiceItems from "../../fiscal/invoices/invoice-items/invoice-items.model";
import Invoice from "../../fiscal/invoices/invoice/invoice.model";
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

  // Produtos do lote que ainda faltam bipar.
  findPendingProductIds(expeditionBatchId: string): Promise<string[]> {
    return this.repository.findPendingProductIds(expeditionBatchId);
  }
}

export default new ExpeditionBatchItemsService();
