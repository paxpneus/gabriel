import BaseService from "../../../../shared/utils/base-models/base-service";
import StockMovementSourceData from "./stock-movement-source-data.model";
import stockMovementSourceDataRepository, {
  StockMovementSourceDataRepository,
} from "./stock-movement-source-data.repository";

export class StockMovementSourceDataService extends BaseService<
  StockMovementSourceData,
  StockMovementSourceDataRepository
> {
  constructor() {
    super(stockMovementSourceDataRepository);
  }
}

export default new StockMovementSourceDataService();
