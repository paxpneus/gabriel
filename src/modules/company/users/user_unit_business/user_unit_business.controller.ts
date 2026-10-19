import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../../shared/utils/base-models/base-controller";
import UserUnitBusiness from "./user_unit_business.model";
import UserUnitBusinessService from "./user_unit_business.service";

export class UserUnitBusinessController extends BaseController<
  UserUnitBusiness,
  typeof UserUnitBusinessService
> {
  constructor() {
    super(UserUnitBusinessService);
  }

  // ?store_number= de application filtra o index por unit_business_id.
  protected storeNumberField(): StoreNumberField {
    return "unit_business_id";
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
      bulkUpdate: [authenticate, userPermissions],
    };
  }
}

export default new UserUnitBusinessController();
