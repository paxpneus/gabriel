import { FindOptions } from 'sequelize';
import { PaginatedResult, QueryParams } from '../../../../shared/query/query.types';
import BaseService from '../../../../shared/utils/base-models/base-service';
import Invoice from './invoice.model';
import invoiceRepository, { InvoiceRepository } from './invoice.repository';
import UnitBusiness from '../../unit-business/unit-business.model';
import Transporter from '../../transporter/transporter.model';

export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: 'emitted_at',
        sortDir: 'DESC',
      },
      // Campos para busca textual (LIKE)
      searchFields: [
        'customer_name',
        'sender_name',
        'number_system'
      ],
      // Campos permitidos para filtros exatos (WHERE field = value)
      // ADICIONADO: 'type' e 'customer_name' aqui
      filterableFields: [
        'type',          
        'unit_business_id',
        'transporter_id',
        'batch_generated',
        'printed_label',
        'emitted_at',
        'status',
      ],
      sortableFields: [
        'customer_name',
        'createdAt',
        'emitted_at',
        'batch_generated',
        'printed_label',
        'type',
      ],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">
  ): Promise<PaginatedResult<Invoice>> {
    
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: UnitBusiness,
          as: 'unitBusiness'
        },
        {
          model: Transporter,
          as: 'transporter'
        }
      ]
    });
  }
}

export default new InvoiceService();
