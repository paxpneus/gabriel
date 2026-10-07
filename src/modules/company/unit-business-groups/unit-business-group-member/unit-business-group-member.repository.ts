import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UnitBusinessGroupMember from "./unit-business-group-member.model";

export class UnitBusinessGroupMemberRepository extends BaseRepository<UnitBusinessGroupMember> {
  constructor() {
    super(UnitBusinessGroupMember);
  }
}

export default new UnitBusinessGroupMemberRepository();
