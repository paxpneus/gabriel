import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import KitComponent from "./kit-component.model";

export class KitComponentRepository extends BaseRepository<KitComponent> {
  constructor() {
    super(KitComponent);
  }

  async syncForKit(
    productKitId: string,
    components: Array<{ product_component_id: string; quantity: number }>,
    options?: { transaction?: Transaction },
  ): Promise<void> {
    const transaction = options?.transaction;
    const desiredIds = components.map((c) => c.product_component_id);

    await this.model.destroy({
      where: {
        product_kit_id: productKitId,
        ...(desiredIds.length
          ? { product_component_id: { [Op.notIn]: desiredIds } }
          : {}),
      },
      transaction,
    });

    for (const component of components) {
      await this.upsertByFind(
        {
          product_kit_id: productKitId,
          product_component_id: component.product_component_id,
        },
        { quantity: component.quantity },
        {
          product_kit_id: productKitId,
          product_component_id: component.product_component_id,
          quantity: component.quantity,
        },
        { transaction },
      );
    }
  }
}

export default new KitComponentRepository();
