import BaseService from '../../../shared/utils/base-models/base-service';
import Product from './product.model';
import productRepository, { ProductRepository } from './product.repository';

export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);
  }
}

export default new ProductService();
