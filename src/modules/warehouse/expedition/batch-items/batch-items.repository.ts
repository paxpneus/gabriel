import { Op } from 'sequelize';
import sequelize from '../../../../config/sequelize';
import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import ExpeditionBatchItems from './batch-items.model';

export class ExpeditionBatchItemsRepository extends BaseRepository<ExpeditionBatchItems> {
  constructor() {
    super(ExpeditionBatchItems);
  }

  // Produtos do lote que ainda faltam bipar (quantity_scanned < quantity) — usado pela auto busca de pneu.
  async findPendingProductIds(expeditionBatchId: string): Promise<string[]> {
    const items = await this.model.findAll({
      where: {
        expedition_batch_id: expeditionBatchId,
        quantity_scanned: { [Op.lt]: sequelize.col('quantity') },
      },
      attributes: ['product_id'],
    });
    return items.map((item) => item.product_id);
  }
}

export default new ExpeditionBatchItemsRepository();
