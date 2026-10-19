import  StockService from './stock.service';
import BaseController, { StoreNumberField } from '../../../../shared/utils/base-models/base-controller';
import Stock from './stock.model';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';

export class StockController extends BaseController<Stock, typeof StockService> {
  constructor() {
    super(StockService);
  }

  // Sem middlewaresFor o CRUD de estoque ficava aberto sem login.
  // ?store_number= de application filtra o index por unit_business_id.
  protected storeNumberField(): StoreNumberField {
    return 'unit_business_id';
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new StockController();
