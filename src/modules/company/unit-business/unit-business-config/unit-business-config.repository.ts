import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UnitBusinessConfig from "./unit-business-config.model";

export class UnitBusinessConfigRepository extends BaseRepository<UnitBusinessConfig> {
  constructor() {
    super(UnitBusinessConfig);
  }
}

export default new UnitBusinessConfigRepository();
