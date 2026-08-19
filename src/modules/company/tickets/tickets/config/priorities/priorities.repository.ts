import BaseRepository from "../../../../../../shared/utils/base-models/base-repository";
import Priority from "./priorities.model";
export class PriorityRepository extends BaseRepository<Priority> { constructor() { super(Priority); } }
export default new PriorityRepository();
