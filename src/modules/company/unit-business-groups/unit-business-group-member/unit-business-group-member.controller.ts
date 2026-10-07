import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import UnitBusinessGroupMember from "./unit-business-group-member.model";
import UnitBusinessGroupMemberService from "./unit-business-group-member.service";

export class UnitBusinessGroupMemberController extends BaseController<
  UnitBusinessGroupMember,
  typeof UnitBusinessGroupMemberService
> {
  constructor() {
    super(UnitBusinessGroupMemberService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }
}

export default new UnitBusinessGroupMemberController();
