import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import InvoiceOperation from "./invoice-operation.model";
import { InvoiceOperationCode } from "./invoice-operation.types";

export class InvoiceOperationRepository extends BaseRepository<InvoiceOperation> {
  // Tabela fixa (seed da m351): id por code cacheado em processo; null não entra no cache (seed ainda não rodado).
  private idByCode = new Map<string, string>();

  constructor() {
    super(InvoiceOperation);
  }

  // Id da operação pelo code; null se o code não existe na tabela.
  async findIdByCode(code: InvoiceOperationCode): Promise<string | null> {
    const cached = this.idByCode.get(code);
    if (cached) return cached;

    const row = await InvoiceOperation.findOne({ where: { code }, attributes: ["id"] });
    if (!row) return null;
    this.idByCode.set(code, row.id);
    return row.id;
  }
}

export default new InvoiceOperationRepository();
