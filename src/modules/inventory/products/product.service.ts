import { FindOptions, Op } from 'sequelize';
import { PaginatedResult, QueryParams } from '../../../shared/query/query.types';
import BaseService from '../../../shared/utils/base-models/base-service';
import Product from './product.model';
import productRepository, { ProductRepository } from './product.repository';
import Stock from '../stock/stock.model';

type StockUnitFilter = {
  unitBusinessId?: string;
  stockUnit?: 'positive' | 'zero';
};

export class ProductService extends BaseService<Product, ProductRepository> {
  constructor() {
    super(productRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ['created_at', 'name'],
        sortDir: 'DESC',
      },
      searchFields: ['name', 'ean', 'ean_tribut', 'sku'],
      filterableFields: ['type'],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, 'where' | 'limit' | 'offset' | 'order'>,
  ): Promise<PaginatedResult<Product>> {
    const stockFilter =
      params.filters?.stockUnit &&
      typeof params.filters.stockUnit === 'object' &&
      !Array.isArray(params.filters.stockUnit)
        ? (params.filters.stockUnit as StockUnitFilter)
        : undefined;

    const stockWhere: Record<string, unknown> = {};

    if (stockFilter?.unitBusinessId) {
      stockWhere.unit_business_id = stockFilter.unitBusinessId;
    }

    if (stockFilter?.stockUnit) {
      stockWhere.quantity =
        stockFilter.stockUnit === 'positive' ? { [Op.gt]: 0 } : { [Op.lte]: 0 };
    }

    const filters = { ...params.filters };
    delete filters.stockUnit;

    const paramsWithoutStockFilter: QueryParams = {
      ...params,
      filters: Object.keys(filters).length ? filters : undefined,
    };

    return super.paginate(paramsWithoutStockFilter, {
      ...extraOptions,
      subQuery: false,
      include: [
        {
          model: Stock,
          as: 'stocks',
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          required: !!stockFilter?.stockUnit,
          attributes: ['id', 'quantity', 'unit_business_id', 'total_price'],
        },
      ],
    });
  }
}

export default new ProductService();
