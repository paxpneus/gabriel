import BaseRepository from "../../../shared/utils/base-models/base-repository";
import KitComponent from "./kit-component.model";

export class KitComponentRepository extends BaseRepository<KitComponent> {
  constructor() {
    super(KitComponent);
  }
}

export default new KitComponentRepository();
