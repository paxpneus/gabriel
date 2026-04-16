import BaseRepository from '../../../shared/utils/base-models/base-repository';
import UnitBusiness from './unit-business.model';

export class UnitBusinessRepository extends BaseRepository<UnitBusiness> {
  constructor() {
    super(UnitBusiness);
  }
}

export default new UnitBusinessRepository();
