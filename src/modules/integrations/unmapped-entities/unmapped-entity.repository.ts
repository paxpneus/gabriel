import BaseRepository from "../../../shared/utils/base-models/base-repository";
import UnmappedEntity from "./unmapped-entity.model";

export class UnmappedEntityRepository extends BaseRepository<UnmappedEntity> {
  constructor() {
    super(UnmappedEntity);
  }
}

export default new UnmappedEntityRepository();
