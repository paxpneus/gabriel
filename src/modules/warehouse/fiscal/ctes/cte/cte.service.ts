import BaseService from '../../../../../shared/utils/base-models/base-service';
import Cte from './cte.model';
import cteRepository, {CteRepository} from './cte.repository';

export class CteService extends BaseService<Cte, CteRepository> {
  constructor() {
    super(cteRepository);
  }
}

export default new CteService();
