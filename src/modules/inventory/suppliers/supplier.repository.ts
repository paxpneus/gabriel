import BaseRepository from '../../../shared/utils/base-models/base-repository';
import Supplier from './supplier.model';

export class SupplierRepository extends BaseRepository<Supplier> {
  constructor() {
    super(Supplier);
  }
}

export default new SupplierRepository();
