import BaseRepository from '../../../shared/utils/base-models/base-repository';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';

export class UnmappedInvoiceProductRepository extends BaseRepository<UnmappedInvoiceProduct> {
  constructor() {
    super(UnmappedInvoiceProduct);
  }
}

export default new UnmappedInvoiceProductRepository();
