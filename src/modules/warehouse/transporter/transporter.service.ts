import BaseService from '../../../shared/utils/base-models/base-service';
import Transporter from './transporter.model';
import transporterRepository, { TransporterRepository } from './transporter.repository';

export class TransporterService extends BaseService<Transporter, TransporterRepository> {
  constructor() {
    super(transporterRepository);
  }
}

export default new TransporterService();
