import BaseRepository from '../../../shared/utils/base-models/base-repository';
import ProductConfig from './product_config.model';

export class ProductConfigRepository extends BaseRepository<ProductConfig> {
  constructor() {
    super(ProductConfig);
  }
}

export default new ProductConfigRepository();