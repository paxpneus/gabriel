import BaseService from '../../../shared/utils/base-models/base-service';
import UnitBusiness from './unit-business.model';
import unitBusinessRepository, { UnitBusinessRepository } from './unit-business.repository';
import { UnitBusinessAttributes } from './unit-business.types';

export class UnitBusinessService extends BaseService<UnitBusiness, UnitBusinessRepository> {
  constructor() {
    super(unitBusinessRepository);
  }

  async getHeadOffice(): Promise<UnitBusinessAttributes> {
    const headOffice = await this.repository.findOne({
      where: {head_office: true}
    })

    if (!headOffice) {
      throw Error('Matriz não cadastrada')
    }

    return headOffice
  }
}

export default new UnitBusinessService();
