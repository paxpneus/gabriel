import { FindOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import { Product, ProductConfig } from "../../../inventory";
import Invoice from "../../invoices/invoice/invoice.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import User from "../../../company/users/users/user.model";
import OperationsItens from "../operations-itens/operations-itens.model";
import Operations from "./operations.model";

export class OperationsRepository extends BaseRepository<Operations> {
  constructor() {
    super(Operations);
  }

  findByIdWithRelations(id: string, unitBusinessId?: string, options?: FindOptions) {
  return this.findById(id, {
    ...options,
    include: [
      { model: Invoice, as: "invoice" },
      { model: UnitBusiness, as: "fromUnit" },
      { model: UnitBusiness, as: "toUnit" },
      { model: User, as: "requestUser", attributes: ["id", "name", "email"] },
      { model: User, as: "receiverUser", attributes: ["id", "name", "email"] },
      {
        model: OperationsItens,
        as: "items",
        include: [
          {
            model: Product,
            as: "product",
            include: [
              {
                model: ProductConfig,
                as: "productConfigs",
                required: false,
                where: unitBusinessId ? { unit_business_id: unitBusinessId } : undefined,
              },
            ],
          },
        ],
      },
    ],
  });
}
}

export default new OperationsRepository();
