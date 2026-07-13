import { PaginatedResult, QueryParams } from './../../../../shared/query/query.types';
import { FindOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Subgroup from "../subgroup/subgroup.model";
import Group from "./group.model";
import groupRepository, { GroupRepository } from "./group.repository";

export class GroupService extends BaseService<Group, GroupRepository> {
  constructor() {
    super(groupRepository);

    this.queryConfig = {
      filterableFields: ["id", "type"],
      sortableFields: ["name", "type", "createdAt"],
      searchFields: ["name"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  async paginate(params: QueryParams, extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">): Promise<PaginatedResult<Group>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: Subgroup,
          as: "subgroups",
          required: true,
        },
      ],
    });
  }

  async findByIdWithSubgroups(
    id: string,
    options?: FindOptions,
  ): Promise<Group | null> {
    return this.repository.findById(id, {
      ...options,
      include: [
        ...(Array.isArray(options?.include) ? options.include : []),
        {
          model: Subgroup,
          as: "subgroups",
        },
      ],
      order: [[{ model: Subgroup, as: "subgroups" }, "name", "ASC"]],
    });
  }

  
}

export default new GroupService();
