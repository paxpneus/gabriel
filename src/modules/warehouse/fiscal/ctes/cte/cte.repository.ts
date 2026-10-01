import { Op, fn, col } from 'sequelize';
import BaseRepository from '../../../../../shared/utils/base-models/base-repository';
import Cte from './cte.model';
import { CteAttributes } from './cte.types';

export class CteRepository extends BaseRepository<Cte> {
  constructor() {
    super(Cte);
  }

  async findXmlPathsByIds(
      ids: string[],
    ): Promise<Pick<CteAttributes, "id" | "xml_path" | "number" | "xml_key">[]> {
      return this.model.findAll({
        where: { id: ids },
        attributes: ["id", "xml_path", "number"],
      });
    }

  // Mesmo formato que UploaderService.upload devolve: `${directory}/${number}_${id}.xml`.
  async markCloudArchived(ids: string[], normalizedDirectory: string): Promise<void> {
    await this.model.update(
      { cloud_path: fn('concat', `${normalizedDirectory}/`, col('number'), '_', col('id'), '.xml') as unknown as string },
      { where: { id: { [Op.in]: ids } } },
    );
  }
}

export default new CteRepository();
