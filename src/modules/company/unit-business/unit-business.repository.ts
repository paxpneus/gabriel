import BaseRepository from '../../../shared/utils/base-models/base-repository';
import UnitBusinessConfig from './unit-business-config/unit-business-config.model';
import { UnitBusinessConfigAttributes } from './unit-business-config/unit-business-config.types';
import UnitBusiness from './unit-business.model';
import { UnitBusinessAttributes } from './unit-business.types';

export class UnitBusinessRepository extends BaseRepository<UnitBusiness> {
  constructor() {
    super(UnitBusiness);
  }

  async findByIdWithConfig(id: string): Promise<UnitBusinessAttributes> {
    const result = await this.findById(id, {
      include: [
        {
          model: UnitBusinessConfig,
          as: 'config',
        }
      ]
    })

    if (!result) throw new Error("Unit business não encontrado")
    
    return result
  }
}

export default new UnitBusinessRepository();
