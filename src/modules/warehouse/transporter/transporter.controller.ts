import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import BaseController from '../../../shared/utils/base-models/base-controller';
import Transporter from './transporter.model';
import TransporterService from './transporter.service';

export class TransporterController extends BaseController<Transporter, typeof TransporterService> {
  constructor() {
    super(TransporterService);
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
        };
      }
}

export default new TransporterController();
