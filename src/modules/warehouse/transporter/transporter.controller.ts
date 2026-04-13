import BaseController from '../../../shared/utils/base-models/base-controller';
import Transporter from './transporter.model';
import TransporterService from './transporter.service';

export class TransporterController extends BaseController<Transporter, typeof TransporterService> {
  constructor() {
    super(TransporterService);
  }
}

export default new TransporterController();
