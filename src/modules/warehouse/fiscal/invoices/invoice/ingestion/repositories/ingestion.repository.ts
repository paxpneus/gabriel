import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";

// Repository do domínio de ingestão (nota provisória / import de XML); só o CRUD base, necessário pro this.create do service.
export class InvoiceIngestionRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }
}

export default new InvoiceIngestionRepository();
