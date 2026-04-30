import BaseService from '../../../shared/utils/base-models/base-service';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';
import unmappedInvoiceProductRepository, {UnmappedInvoiceProductRepository} from './unmapped-invoice-product.repository';
export class UnmappedInvoiceProductService extends BaseService<UnmappedInvoiceProduct, UnmappedInvoiceProductRepository> {
  constructor() {
    super(unmappedInvoiceProductRepository);
  }
}

export default new UnmappedInvoiceProductService();
