import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Rim from "./rim.model";

export class RimRepository extends BaseRepository<Rim> {
  constructor() {
    super(Rim);
  }
}

export default new RimRepository();
