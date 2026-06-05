import BaseService from '../../../shared/utils/base-models/base-service';
import ProductConfig from './product_config.model';
import productConfigRepository, { ProductConfigRepository } from './product_config.repository';

export class ProductConfigService extends BaseService<ProductConfig, ProductConfigRepository> {
  constructor() {
    super(productConfigRepository);
  }
}

export default new ProductConfigService();