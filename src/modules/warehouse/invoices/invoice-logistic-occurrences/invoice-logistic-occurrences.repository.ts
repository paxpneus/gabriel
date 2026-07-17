import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";

export class InvoiceLogisticOccurrencesRepository extends BaseRepository<InvoiceLogisticOccurrences> {
  constructor() {
    super(InvoiceLogisticOccurrences);
  }
}

export default new InvoiceLogisticOccurrencesRepository();