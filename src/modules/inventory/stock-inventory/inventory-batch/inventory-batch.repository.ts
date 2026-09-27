import { Sequelize, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import InventoryBatchItems from "../inventory-batch-items/inventory-batch-items.model";
import InventoryBatch from "./inventory-batch.model";

export class InventoryBatchRepository extends BaseRepository<InventoryBatch> {
  constructor() {
    super(InventoryBatch);
  }

  async syncBatchTotals(
    batchId: string,
    forceBatchFinish: boolean = true,
    t: Transaction,
  ): Promise<{
    totalQuantityRead: number;
    totalQuantityStock: number;
    totalPrice: number;
    itemCount: number;
    finishedCount: number;
  }> {
    // Lock aqui, não no início do scanProduct: essa é a seção que
    // efetivamente lê+agrega os itens e escreve o total do batch, então é o
    // único trecho que precisa ser serializado entre conferentes concorrentes.
    const batch = await InventoryBatch.findByPk(batchId, {
      attributes: ["mode"],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Agregado calculado no Postgres, não carregando toda a linha de cada
    // item pro Node: antes disso, syncBatchTotals recarregava TODOS os itens
    // do lote (com um include de Stock que nem era usado) a cada bipagem —
    // ficava mais lento conforme o lote crescia, chamado 2x por scan.
    const totals = (await InventoryBatchItems.findOne({
      where: { inventory_batch_id: batchId },
      attributes: [
        [
          Sequelize.fn("COALESCE", Sequelize.fn("SUM", Sequelize.col("quantity_read")), 0),
          "totalQuantityRead",
        ],
        [
          Sequelize.fn("COALESCE", Sequelize.fn("SUM", Sequelize.col("quantity_stock")), 0),
          "totalQuantityStock",
        ],
        [
          Sequelize.fn("COALESCE", Sequelize.fn("SUM", Sequelize.col("price")), 0),
          "totalPrice",
        ],
        [Sequelize.fn("COUNT", Sequelize.col("id")), "itemCount"],
        [
          Sequelize.fn(
            "COUNT",
            Sequelize.literal(`CASE WHEN status = 'FINISHED' THEN 1 END`),
          ),
          "finishedCount",
        ],
      ],
      raw: true,
      transaction: t,
    })) as unknown as {
      totalQuantityRead: string;
      totalQuantityStock: string;
      totalPrice: string;
      itemCount: string;
      finishedCount: string;
    };

    const totalQuantityRead = Number(totals?.totalQuantityRead ?? 0);
    const totalQuantityStock = Number(totals?.totalQuantityStock ?? 0);
    const totalPrice = Number(totals?.totalPrice ?? 0);
    const itemCount = Number(totals?.itemCount ?? 0);
    const finishedCount = Number(totals?.finishedCount ?? 0);

    const payload: Partial<InventoryBatch> = {
      total_quantity_read: totalQuantityRead,
      total_quantity_stock: totalQuantityStock,
      total_price: totalPrice,
    };

    // Lote CYCLIC nunca finaliza sozinho — só via finishBatch manual, senão bloquearia novas leituras no meio da contagem
    if (forceBatchFinish && batch?.mode !== "CYCLIC") {
      const allFinished = itemCount > 0 && finishedCount === itemCount;
      payload.status = allFinished ? "FINISHED" : "PENDING";
    }

    await InventoryBatch.update(payload, {
      where: { id: batchId },
      transaction: t,
    });

    return { totalQuantityRead, totalQuantityStock, totalPrice, itemCount, finishedCount };
  }
}
export default new InventoryBatchRepository();
