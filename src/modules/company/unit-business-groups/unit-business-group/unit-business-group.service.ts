import BaseService from "../../../../shared/utils/base-models/base-service";
import UnitBusinessGroup from "./unit-business-group.model";
import unitBusinessGroupRepository, {
  UnitBusinessGroupRepository,
} from "./unit-business-group.repository";

export class UnitBusinessGroupService extends BaseService<
  UnitBusinessGroup,
  UnitBusinessGroupRepository
> {
  constructor() {
    super(unitBusinessGroupRepository);

    this.queryConfig = {
      filterableFields: ["id", "name"],
      sortableFields: ["createdAt", "name"],
      searchFields: ["name", "description"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  getFullById(id: string) {
    return this.repository.getFullById(id);
  }
}

export default new UnitBusinessGroupService();
