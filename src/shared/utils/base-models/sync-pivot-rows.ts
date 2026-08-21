import { Model, ModelStatic, Op, Transaction } from "sequelize";

interface SyncPivotRowsParams {
  ownerField: string;
  ownerId: string;
  targetField: string;
  targetIds: string[];
}

// Generaliza o padrão já usado em KitComponentRepository.syncForKit: destrói
// as linhas que saíram (Op.notIn) e cria as que faltam. Pivôs simples (só as
// duas FKs, sem payload extra) não precisam de update — só existir ou não.
export async function syncPivotRows<T extends Model>(
  model: ModelStatic<T>,
  { ownerField, ownerId, targetField, targetIds }: SyncPivotRowsParams,
  options?: { transaction?: Transaction },
): Promise<void> {
  const transaction = options?.transaction;

  await model.destroy({
    where: {
      [ownerField]: ownerId,
      ...(targetIds.length
        ? { [targetField]: { [Op.notIn]: targetIds } }
        : {}),
    } as any,
    transaction,
  });

  for (const targetId of targetIds) {
    const where = { [ownerField]: ownerId, [targetField]: targetId } as any;
    const existing = await model.findOne({ where, transaction });
    if (!existing) {
      await model.create(
        { [ownerField]: ownerId, [targetField]: targetId } as any,
        { transaction },
      );
    }
  }
}
