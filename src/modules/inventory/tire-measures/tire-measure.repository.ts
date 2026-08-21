import BaseRepository from "../../../shared/utils/base-models/base-repository";
import TireMeasure from "./tire-measure.model";

export class TireMeasureRepository extends BaseRepository<TireMeasure> {
  constructor() {
    super(TireMeasure);
  }
}

export default new TireMeasureRepository();
