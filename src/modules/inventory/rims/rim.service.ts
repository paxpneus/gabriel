import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import Rim from "./rim.model";
import rimRepository, { RimRepository } from "./rim.repository";

export class RimService extends BaseService<Rim, RimRepository> {
  constructor() {
    super(rimRepository);

    this.queryConfig = {
      filterableFields: ["id"],
      sortableFields: ["value", "createdAt"],
      searchFields: ["value"],
      defaults: {
        perPage: 20,
        sortBy: "value",
        sortDir: "ASC",
      },
    };
  }

  async findOrCreate(
    value: string | null | undefined,
    options?: { transaction?: Transaction },
  ): Promise<Rim | null> {
    const normalized = value?.trim();
    if (!normalized) return null;

    return this.repository.upsertByFind(
      { value: normalized },
      {},
      { value: normalized },
      options,
    );
  }
}

export default new RimService();
