import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import StockMovementSourceData from "./stock-movement-source-data.model";

export class StockMovementSourceDataRepository extends BaseRepository<StockMovementSourceData> {
  constructor() {
    super(StockMovementSourceData);
  }
}

export default new StockMovementSourceDataRepository();
