import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import Group from "./group.model";

export class GroupRepository extends BaseRepository<Group> {
  constructor() {
    super(Group);
  }
}

export default new GroupRepository();
