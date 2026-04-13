import BaseController from '../../../shared/utils/base-models/base-controller';
import Stock from './stock.model';
import StockService from './stock.service';

export class StockController extends BaseController<Stock, typeof StockService> {
  constructor() {
    super(StockService);
  }
}

export default new StockController();
