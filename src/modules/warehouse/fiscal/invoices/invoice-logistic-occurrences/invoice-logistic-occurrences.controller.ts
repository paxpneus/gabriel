import { authenticate } from "../../../../../middlewares/auth-token";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";
import InvoiceLogisticOccurrencesService from "./invoice-logistic-occurrences.service";

export class InvoiceLogisticOccurrencesController extends BaseController<
  InvoiceLogisticOccurrences,
  typeof InvoiceLogisticOccurrencesService
> {
  constructor() {
    super(InvoiceLogisticOccurrencesService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      create: [authenticate],
      update: [authenticate],
      show: [authenticate],
      destroy: [authenticate],
      login: [authenticate],
      // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
      bulkCreate: [authenticate],
      bulkUpdate: [authenticate],
      bulkDestroy: [authenticate],
    };
  }
}

export default new InvoiceLogisticOccurrencesController();