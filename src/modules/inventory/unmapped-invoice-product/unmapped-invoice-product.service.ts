import { FindOptions } from 'sequelize';
import { PaginatedResult, QueryParams } from '../../../shared/query/query.types';
import BaseService from '../../../shared/utils/base-models/base-service';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';
import unmappedInvoiceProductRepository, {UnmappedInvoiceProductRepository} from './unmapped-invoice-product.repository';
import { Invoice } from '../../warehouse';
import sequelize from '../../../config/sequelize';
export class UnmappedInvoiceProductService extends BaseService<UnmappedInvoiceProduct, UnmappedInvoiceProductRepository> {
  constructor() {
    super(unmappedInvoiceProductRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["product_name", "ean", "sku"],
      filterableFields: ["status"],
      sortableFields: ["product_name", "ean", "sku"],
    };
  }

    async paginate(
      params: QueryParams,
      extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    ): Promise<PaginatedResult<UnmappedInvoiceProduct>> {
      return super.paginate(params, {
        ...extraOptions,
        include: [
          {
            model: Invoice,
            as: "invoice",
            attributes: ['number_system', 'id']
          },
        ],
      });
    }
  
    async markMapped(ids: string[]): Promise<void> {
        return await sequelize.transaction(async (t) => {
      const unmapped = await this.findAll({
        where: {
          id: ids
        },
        transaction: t
      })
      
      if (!unmapped.length) {
        throw new Error("Produto(s) não mapeado(s) não encontrado(s)");
      }

      await this.bulkUpdate(
        {
          status: 'MAPPED'
        },
        {
          where: {
            id: ids
          },
          transaction: t
        }
      )
    })  
      }
  
}

export default new UnmappedInvoiceProductService();
