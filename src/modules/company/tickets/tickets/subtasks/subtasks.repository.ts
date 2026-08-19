import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import Subtask from "./subtasks.model";
export class SubtaskRepository extends BaseRepository<Subtask> { constructor() { super(Subtask); } }
export default new SubtaskRepository();
