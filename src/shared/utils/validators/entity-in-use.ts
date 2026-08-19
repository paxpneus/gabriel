import { Model, ModelStatic, WhereOptions } from "sequelize";

export const ENTITY_IN_USE_ERROR =
  "Não é possível remover essa entidade, pois ela está sendo usada em outras Demandas.";

export async function throwIfEntityIsInUse(
  model: ModelStatic<Model>,
  where: WhereOptions,
): Promise<void> {
  const used = await model.count({ where });

  if (used > 0) throw new Error(ENTITY_IN_USE_ERROR);
}
