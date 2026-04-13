import BaseRepository from '../../../shared/utils/base-models/base-repository';
import SupplierMapping from './supplier-mapping.model';

export class SupplierMappingRepository extends BaseRepository<SupplierMapping> {
  constructor() {
    super(SupplierMapping);
  }
}

export default new SupplierMappingRepository();
