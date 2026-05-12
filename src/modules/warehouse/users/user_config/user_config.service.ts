import { FindOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { PaginatedResult, QueryParams } from "../../../../shared/query/query.types";
import User from "../users/user.model";
import UserConfig from "./user_config.model";
import userConfigRepository, { UserConfigRepository } from "./user_config.repository";

export class UserConfigService extends BaseService<UserConfig, UserConfigRepository> {
  constructor() {
    super(userConfigRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      filterableFields: [
        "user_id",
        "theme",
        "language",
        "timezone",
        "notifications_enabled",
        "compact_mode",
      ],
      sortableFields: ["createdAt", "updatedAt", "items_per_page"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<UserConfig>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: User,
          as: "user",
        },
      ],
    });
  }
}

export default new UserConfigService();
