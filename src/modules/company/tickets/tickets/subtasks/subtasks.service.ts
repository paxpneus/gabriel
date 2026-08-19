import BaseService from "../../../../../shared/utils/base-models/base-service";
import Subtask from "./subtasks.model";
import subtaskRepository, { SubtaskRepository } from "./subtasks.repository";
export class SubtaskService extends BaseService<Subtask, SubtaskRepository> { constructor() { super(subtaskRepository); this.queryConfig = { filterableFields: ["ticket_id", "is_completed"], sortableFields: ["display_order", "createdAt"], searchFields: ["description"], defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" } }; } }
export default new SubtaskService();
