import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import TireMeasure from "./tire-measure.model";
import tireMeasureRepository, {
  TireMeasureRepository,
} from "./tire-measure.repository";
import { stripRimFromMeasure } from "./helpers/normalize";

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
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const normalized = stripRimFromMeasure(trimmed);

    return this.repository.upsertByFind(
      { value: normalized },
      {},
      { value: normalized },
      options,
    );
  }
}

export default new TireMeasureService();
