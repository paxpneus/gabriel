import BaseRepository from '../../../shared/utils/base-models/base-repository';
import Stock from './stock.model';

export class StockRepository extends BaseRepository<Stock> {
  constructor() {
    super(Stock);
  }
}

export default new StockRepository();
