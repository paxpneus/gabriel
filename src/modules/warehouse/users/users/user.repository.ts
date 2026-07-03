import { FindOptions } from 'sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import User from './user.model';
import UnitBusiness from '../../unit-business/unit-business.model';
import UserConfig from '../user_config/user_config.model';

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
          },
          {
            model: UserConfig,
            as: 'config'
          }
        ]
      })
  }
}

export default new UserRepository();
