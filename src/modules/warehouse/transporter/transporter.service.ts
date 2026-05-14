import { FindOptions } from 'sequelize';
import BaseService from '../../../shared/utils/base-models/base-service';
import Transporter from './transporter.model';
import transporterRepository, { TransporterRepository } from './transporter.repository';
import CarrierImportLayout from './carrier-import-layouts/carrier-import-layouts.model';

export class TransporterService extends BaseService<Transporter, TransporterRepository> {
  constructor() {
    super(transporterRepository);

     this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["name",],
      sortableFields: ["createdAt"],
    };
  }

  

  async findById(id: string, options?: FindOptions): Promise<Transporter | null> {
      return await this.repository.findById(id, {
        include: [
          {
            model: CarrierImportLayout,
            as: 'importLayout'
          }
        ]
      })
  }
}

export default new TransporterService();
