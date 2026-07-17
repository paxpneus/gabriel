import BaseService from "../../../../shared/utils/base-models/base-service";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "./invoice-logistic-occurrences.repository";

export class InvoiceLogisticOccurrencesService extends BaseService<
  InvoiceLogisticOccurrences,
  InvoiceLogisticOccurrencesRepository
> {
  constructor() {
    super(invoiceLogisticOccurrencesRepository);
  }
}

export default new InvoiceLogisticOccurrencesService();