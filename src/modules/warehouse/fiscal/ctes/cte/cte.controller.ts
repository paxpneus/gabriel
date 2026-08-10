import  CteService  from './cte.service';
import BaseController from '../../../../../shared/utils/base-models/base-controller';
import Cte from './cte.model';
export class CteController extends BaseController<Cte, typeof CteService> {
  constructor() {
    super(CteService);
  }
}

export default new CteController();
