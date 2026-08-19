import { DestroyOptions, Op } from "sequelize";
import BaseService from "../../../../../../shared/utils/base-models/base-service";
import { throwIfEntityIsInUse } from "../../../../../../shared/utils/validators/entity-in-use";
import Ticket from "../../ticket/tickets.model";
import Priority from "./priorities.model";
import priorityRepository, { PriorityRepository } from "./priorities.repository";

export class PriorityService extends BaseService<Priority, PriorityRepository> {
  constructor() {
    super(priorityRepository);
    this.queryConfig = {
      sortableFields: ["name", "display_order", "sla_hours", "createdAt"],
      searchFields: ["name"],
      defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" },
    };
  }

  private async ensureNotUsed(priorityIds: string | string[]): Promise<void> {
    await throwIfEntityIsInUse(Ticket, {
      priority_id: Array.isArray(priorityIds)
        ? { [Op.in]: priorityIds }
        : priorityIds,
    });
  }

  async delete(id: string, options?: DestroyOptions) {
    await this.ensureNotUsed(id);
    return super.delete(id, options);
  }

  async bulkDelete(options: DestroyOptions) {
    const ids = (options.where as { id?: { [Op.in]?: string[] } })?.id?.[Op.in];

    if (ids?.length) await this.ensureNotUsed(ids);
    return super.bulkDelete(options);
  }
}
export default new PriorityService();
