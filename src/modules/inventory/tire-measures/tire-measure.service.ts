import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import TireMeasure from "./tire-measure.model";
import tireMeasureRepository, {
  TireMeasureRepository,
} from "./tire-measure.repository";

export class TireMeasureService extends BaseService<
  TireMeasure,
  TireMeasureRepository
> {
  constructor() {
    super(tireMeasureRepository);

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
  ): Promise<TireMeasure | null> {
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

export default new TireMeasureService();
