import BaseController from '../../../shared/utils/base-models/base-controller';
import SupplierMapping from './supplier-mapping.model';
import SupplierMappingService from './supplier-mapping.service';

export class SupplierMappingController extends BaseController<SupplierMapping, typeof SupplierMappingService> {
  constructor() {
    super(SupplierMappingService);
  }
}

export default new SupplierMappingController();
