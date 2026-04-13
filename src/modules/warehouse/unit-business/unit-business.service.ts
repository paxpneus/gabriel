import BaseService from '../../../shared/utils/base-models/base-service';
import UnitBusiness from './unit-business.model';
import unitBusinessRepository, { UnitBusinessRepository } from './unit-business.repository';

export class UnitBusinessService extends BaseService<UnitBusiness, UnitBusinessRepository> {
  constructor() {
    super(unitBusinessRepository);
  }
}

export default new UnitBusinessService();
