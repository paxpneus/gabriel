import BaseController from '../../../shared/utils/base-models/base-controller';
import UnitBusiness from './unit-business.model';
import UnitBusinessService from './unit-business.service';

export class UnitBusinessController extends BaseController<UnitBusiness, typeof UnitBusinessService> {
  constructor() {
    super(UnitBusinessService);
  }
}

export default new UnitBusinessController();
