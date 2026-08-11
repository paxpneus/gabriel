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
}

export default new CteRepository();
