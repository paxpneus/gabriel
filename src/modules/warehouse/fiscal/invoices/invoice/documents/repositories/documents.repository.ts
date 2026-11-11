import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";

// Repository do domínio documents: só o CRUD base da nota (as leituras de XML/atributos vêm do shared).
export class InvoiceDocumentsRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }
}

export default new InvoiceDocumentsRepository();
