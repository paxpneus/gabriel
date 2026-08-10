import BaseRepository from '../../../../../shared/utils/base-models/base-repository';
import Cte from './cte.model';

export class CteRepository extends BaseRepository<Cte> {
  constructor() {
    super(Cte);
  }
}

export default new CteRepository();
