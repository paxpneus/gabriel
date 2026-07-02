import BaseService from "../../../../shared/utils/base-models/base-service";
import State from "./state.model";
import stateRepository, { StateRepository } from "./state.repository";

export class StateService extends BaseService<State, StateRepository> {
  constructor() {
    super(stateRepository);

    this.queryConfig = {
      filterableFields: ["id", "acronym"],
      sortableFields: ["name", "acronym", "tax_rate", "createdAt"],
      searchFields: ["name", "acronym"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }
}

export default new StateService();
