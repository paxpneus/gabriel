import { FindOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { PaginatedResult, QueryParams } from "../../../../shared/query/query.types";
import UnitBusiness from "../../unit-business/unit-business.model";
import User from "../users/user.model";
import UserUnitBusiness from "./user_unit_business.model";
import userUnitBusinessRepository, {
  UserUnitBusinessRepository,
} from "./user_unit_business.repository";

export class UserUnitBusinessService extends BaseService<
  UserUnitBusiness,
  UserUnitBusinessRepository
> {
  constructor() {
    super(userUnitBusinessRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      filterableFields: ["user_id", "unit_business_id"],
      sortableFields: ["createdAt", "updatedAt"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<UserUnitBusiness>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: User,
          as: "user",
        },
        {
          model: UnitBusiness,
          as: "unitBusiness",
        },
      ],
    });
  }
}

export default new UserUnitBusinessService();
