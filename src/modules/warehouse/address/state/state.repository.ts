import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import State from "./state.model";

export class StateRepository extends BaseRepository<State> {
  constructor() {
    super(State);
  }
}

export default new StateRepository();
