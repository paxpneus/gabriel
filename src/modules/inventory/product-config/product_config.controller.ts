import BaseController from '../../../shared/utils/base-models/base-controller';
import ProductConfig from './product_config.model';
import ProductConfigService from './product_config.service';

export class ProductConfigController extends BaseController<ProductConfig, typeof ProductConfigService> {
  constructor() {
    super(ProductConfigService);
  }
}

export default new ProductConfigController();