import BaseService from "../../../../../../shared/utils/base-models/base-service";
import Priority from "./priorities.model";
import priorityRepository, { PriorityRepository } from "./priorities.repository";
export class PriorityService extends BaseService<Priority, PriorityRepository> { constructor() { super(priorityRepository); this.queryConfig = { sortableFields: ["name", "display_order", "sla_hours", "createdAt"], searchFields: ["name"], defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" } }; } }
export default new PriorityService();
