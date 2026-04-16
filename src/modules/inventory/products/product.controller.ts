import BaseController from '../../../shared/utils/base-models/base-controller';
import Product from './product.model';
import ProductService from './product.service';

export class ProductController extends BaseController<Product, typeof ProductService> {
  constructor() {
    super(ProductService);
  }
}

export default new ProductController();
