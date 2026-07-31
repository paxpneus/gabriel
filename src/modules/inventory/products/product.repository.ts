import { FindOptions } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import Product from './product.model';
import Stock from '../stock/stock/stock.model';
import ProductConfig from '../product-config/product_config.model';

export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  async findByIdWithRelations(
    id: string,
    unitBusinessId?: string,
    options?: FindOptions,
  ): Promise<Product | null> {
    return this.findById(id, {
      ...options,
      attributes: { exclude: ['source_payload'] },
      include: [
        {
          model: Stock,
          as: 'stocks',
          where: unitBusinessId ? { unit_business_id: unitBusinessId } : undefined,
          required: false,
          attributes: ['id', 'quantity', 'unit_business_id', 'total_price'],
        },
        {
          model: ProductConfig,
          as: 'productConfigs',
          where: unitBusinessId ? { unit_business_id: unitBusinessId } : undefined,
          required: false,
        },
      ],
    });
  }
}

export default new ProductRepository();