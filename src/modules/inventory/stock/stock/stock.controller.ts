import  StockService from './stock.service';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import Stock from './stock.model';

export class StockController extends BaseController<Stock, typeof StockService> {
  constructor() {
    super(StockService);
  }
}

export default new StockController();
