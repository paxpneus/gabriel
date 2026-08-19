import { DestroyOptions, Op } from "sequelize";
import BaseService from "../../../../../../shared/utils/base-models/base-service";
import { throwIfEntityIsInUse } from "../../../../../../shared/utils/validators/entity-in-use";
import Ticket from "../../ticket/tickets.model";
import TicketStatusHistory from "../../ticket-status-histories/ticket-status-histories.model";
import TicketStatus from "./ticket-statuses.model";
import ticketStatusRepository, { TicketStatusRepository } from "./ticket-statuses.repository";

export class TicketStatusService extends BaseService<
  TicketStatus,
  TicketStatusRepository
> {
  constructor() {
    super(ticketStatusRepository);
    this.queryConfig = {
      filterableFields: ["completed", "canceled", "is_active"],
      sortableFields: ["name", "display_order", "createdAt"],
      searchFields: ["name"],
      defaults: { perPage: 20, sortBy: "display_order", sortDir: "ASC" },
    };
  }

  private async ensureNotUsed(statusIds: string | string[]): Promise<void> {
    const statusId = Array.isArray(statusIds)
      ? { [Op.in]: statusIds }
      : statusIds;
    await Promise.all([
      throwIfEntityIsInUse(Ticket, { status_id: statusId }),
      throwIfEntityIsInUse(TicketStatusHistory, { status_id: statusId }),
    ]);
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
export default new TicketStatusService();
