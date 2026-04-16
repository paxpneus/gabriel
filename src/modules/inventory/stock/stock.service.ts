import BaseService from '../../../shared/utils/base-models/base-service';
import Stock from './stock.model';
import stockRepository, { StockRepository } from './stock.repository';

export class StockService extends BaseService<Stock, StockRepository> {
  constructor() {
    super(stockRepository);
  }
}

export default new StockService();
