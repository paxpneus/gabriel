import { authenticate } from '../../../middlewares/auth-token';
import BaseController from '../../../shared/utils/base-models/base-controller';
import Transporter from './transporter.model';
import TransporterService from './transporter.service';

export class TransporterController extends BaseController<Transporter, typeof TransporterService> {
  constructor() {
    super(TransporterService);
  }

  protected middlewaresFor() {
        return {
          index: [authenticate],
          create: [authenticate],
          update: [
            authenticate
          ],
          show: [authenticate],
          destroy: [authenticate],
          login: [authenticate],
        };
      }
}

export default new TransporterController();
