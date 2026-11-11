import BaseService from "../../../../../shared/utils/base-models/base-service";
import InvoiceOperation from "./invoice-operation.model";
import invoiceOperationRepository, { InvoiceOperationRepository } from "./invoice-operation.repository";

// CRUD das operações de nota (o front lista pra filtrar notas por operação).
export class InvoiceOperationService extends BaseService<InvoiceOperation, InvoiceOperationRepository> {
  constructor() {
    super(invoiceOperationRepository);
    // Lista na ordem do code (10, 20, ...), não por data de criação.
    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "code", sortDir: "ASC" },
      sortableFields: ["code", "description"],
      searchFields: ["description"],
      filterableFields: ["code"],
    };
  }
}

export default new InvoiceOperationService();
