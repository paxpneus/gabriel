import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { Product } from "../../../inventory";
import Invoice from "../../entrance/invoice/invoice.model";
import UnitBusiness from "../../unit-business/unit-business.model";
import OperationsItens from "../operations-itens/operations-itens.model";
import Operations from "./operations.model";

export class OperationsRepository extends BaseRepository<Operations> {
  constructor() {
    super(Operations);
  }

  findByIdWithRelations(id: string) {
    return this.findById(id, {
      include: [
        { model: Invoice, as: "invoice" },
        { model: UnitBusiness, as: "fromUnit" },
        { model: UnitBusiness, as: "toUnit" },
        {
          model: OperationsItens,
          as: "items",
          include: [{ model: Product, as: "product" }],
        },
      ],
    });
  }
}

export default new OperationsRepository();
