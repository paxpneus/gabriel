import BaseService from '../../../shared/utils/base-models/base-service';
import Product from './product.model';
import productRepository, { ProductRepository } from './product.repository';

export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "created_at",
        sortDir: "DESC",
      },
      // Campos para busca textual (LIKE)
      searchFields: ["name", "ean", "ean_tribut"],
      
     
    };
  }
}

export default new ProductService();
