import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UserUnitBusiness from "./user_unit_business.model";

export class UserUnitBusinessRepository extends BaseRepository<UserUnitBusiness> {
  constructor() {
    super(UserUnitBusiness);
  }
}

export default new UserUnitBusinessRepository();
