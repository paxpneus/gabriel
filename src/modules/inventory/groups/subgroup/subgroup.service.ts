import { FindOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Group from "../group/group.model";
import Subgroup from "./subgroup.model";
import subgroupRepository, {
  SubgroupRepository,
} from "./subgroup.repository";

export class SubgroupService extends BaseService<
  Subgroup,
  SubgroupRepository
> {
  constructor() {
    super(subgroupRepository);

    this.queryConfig = {
      filterableFields: ["id", "group_id"],
      sortableFields: ["name", "createdAt"],
      searchFields: ["name"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  async findByIdWithGroup(
    id: string,
    options?: FindOptions,
  ): Promise<Subgroup | null> {
    return this.repository.findById(id, {
      ...options,
      include: [
        ...(Array.isArray(options?.include) ? options.include : []),
        {
          model: Group,
          as: "group",
        },
      ],
    });
  }

  async findAllWithGroup(options?: FindOptions): Promise<Subgroup[]> {
    return this.repository.findAll({
      ...options,
      include: [
        ...(Array.isArray(options?.include) ? options.include : []),
        {
          model: Group,
          as: "group",
        },
      ],
      order: [
        ["name", "ASC"],
        [{ model: Group, as: "group" }, "name", "ASC"],
      ],
    });
  }
}

export default new SubgroupService();
