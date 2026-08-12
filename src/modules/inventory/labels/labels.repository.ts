import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Label from "./labels.model";

export class LabelRepository extends BaseRepository<Label> {
  constructor() {
    super(Label);
  }
}

export default new LabelRepository();
