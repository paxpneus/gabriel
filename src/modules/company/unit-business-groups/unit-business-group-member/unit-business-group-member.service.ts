import BaseService from "../../../../shared/utils/base-models/base-service";
import UnitBusinessGroupMember from "./unit-business-group-member.model";
import unitBusinessGroupMemberRepository, {
  UnitBusinessGroupMemberRepository,
} from "./unit-business-group-member.repository";

export class UnitBusinessGroupMemberService extends BaseService<
  UnitBusinessGroupMember,
  UnitBusinessGroupMemberRepository
> {
  constructor() {
    super(unitBusinessGroupMemberRepository);

    this.queryConfig = {
      filterableFields: ["id", "unit_business_group_id", "unit_business_id"],
      sortableFields: ["createdAt"],
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
    };
  }
}

export default new UnitBusinessGroupMemberService();
