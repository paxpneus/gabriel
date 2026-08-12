import BaseService from "../../../shared/utils/base-models/base-service";
import Label from "./labels.model";
import labelRepository, { LabelRepository } from "./labels.repository";

export class LabelService extends BaseService<Label, LabelRepository> {
  constructor() {
    super(labelRepository);

    this.queryConfig = {
      filterableFields: ["id", "type", "name"],
      sortableFields: ["type", "name", "createdAt"],
      searchFields: ["name", "type"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }
}

export default new LabelService();
