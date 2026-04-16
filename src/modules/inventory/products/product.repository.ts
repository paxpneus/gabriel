import BaseRepository from '../../../shared/utils/base-models/base-repository';
import Product from './product.model';

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }
}

export default new ProductRepository();
