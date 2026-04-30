import { FindOptions } from 'sequelize';
import { PaginatedResult, QueryParams } from '../../../shared/query/query.types';
import BaseService from '../../../shared/utils/base-models/base-service';
import Product from './product.model';
import productRepository, { ProductRepository } from './product.repository';
import Stock from '../stock/stock.model';

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

  async paginate(
      params: QueryParams,
      extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    ): Promise<PaginatedResult<Product>> {
      return super.paginate(params, {
        ...extraOptions,
        include: [
          {
            model: Stock,
            as: 'stocks'
          }
        ]
      })
    }

}

export default new ProductService();
