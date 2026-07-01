import { Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import InvoiceItems from "../../invoices/invoice-items/invoice-items.model";
import Invoice from "../../invoices/invoice/invoice.model";
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

 
}

export default new ExpeditionBatchItemsService();
