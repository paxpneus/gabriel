import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import BaseController, { StoreNumberField } from '../../../shared/utils/base-models/base-controller';
import Transporter from './transporter.model';
import TransporterService from './transporter.service';

export class TransporterController extends BaseController<Transporter, typeof TransporterService> {
  constructor() {
    super(TransporterService);
  }

  // ?store_number= de application filtra o index por integrations_id.
  protected storeNumberField(): StoreNumberField {
    return 'integrations_id';
  }

  protected middlewaresFor() {
        return {
          index: [authenticate, userPermissions],
          create: [authenticate, userPermissions],
          update: [
            authenticate, userPermissions
          ],
          show: [authenticate, userPermissions],
          destroy: [authenticate, userPermissions],
          login: [authenticate, userPermissions],
          // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
          bulkCreate: [authenticate, userPermissions],
          bulkUpdate: [authenticate, userPermissions],
          bulkDestroy: [authenticate, userPermissions],
        };
      }
}

export default new TransporterController();
