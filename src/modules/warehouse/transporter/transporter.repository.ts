import BaseRepository from '../../../shared/utils/base-models/base-repository';
import Transporter from './transporter.model';

export class TransporterRepository extends BaseRepository<Transporter> {
  constructor() {
    super(Transporter);
  }
}

export default new TransporterRepository();
