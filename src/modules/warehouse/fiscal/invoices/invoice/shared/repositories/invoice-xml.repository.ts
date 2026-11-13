import BaseRepository from "../../../../../../../shared/utils/base-models/base-repository";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";

// Leitura dos caminhos de XML das notas (usada por core e documents).
export class InvoiceXmlRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  async findXmlPathsByIds(
    ids: string[],
  ): Promise<Pick<InvoiceAttributes, "id" | "xml_path" | "number_system">[]> {
    return this.model.findAll({
      where: { id: ids },
      attributes: ["id", "xml_path", "number_system"],
    });
  }
}

export default new InvoiceXmlRepository();
