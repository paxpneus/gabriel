import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UserConfig from "./user_config.model";

export class UserConfigRepository extends BaseRepository<UserConfig> {
  constructor() {
    super(UserConfig);
  }
}

export default new UserConfigRepository();
