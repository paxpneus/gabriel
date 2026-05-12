import { FindOptions } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import User from './user.model';
import UnitBusiness from '../../unit-business/unit-business.model';

export class UserRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  async findById(id: string, options?: FindOptions): Promise<User | null> {
      return super.findById(id, {
        include: [
          {
            model: UnitBusiness,
            as: 'availableUnitBusinesses'
          }
        ]
      })
  }
}

export default new UserRepository();
