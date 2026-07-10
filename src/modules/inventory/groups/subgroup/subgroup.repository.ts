import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Subgroup from "./subgroup.model";

export class SubgroupRepository extends BaseRepository<Subgroup> {
  constructor() {
    super(Subgroup);
  }
}

export default new SubgroupRepository();
