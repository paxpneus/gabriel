import { FindOptions, WhereOptions } from "sequelize";
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../../../shared/query/query.types";
import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import Area from "../../../../global/areas/areas.model";
import Priority from "../config/priorities/priorities.model";
import TicketStatus from "../config/ticket-statuses/ticket-statuses.model";
import Ticket from "./tickets.model";
import { FullTicket } from "./tickets.types";
export class TicketRepository extends BaseRepository<Ticket> {
  constructor() {
    super(Ticket);
  }

  paginateWithRelations(
    params: QueryParams,
    config?: QueryConfig,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    forcedWhere?: WhereOptions,
    forcedOrder?: FindOptions["order"],
  ): Promise<PaginatedResult<FullTicket>> {
    return super.findPaginated<FullTicket>(
      params,
      config,
      {
        ...extraOptions,
        include: [
          { association: "requester" },
          { model: Area, as: "area" },
          { model: Priority, as: "priority" },
          { model: TicketStatus, as: "status" },
        ],
      },
      forcedWhere,
      forcedOrder,
    );
  }
}
export default new TicketRepository();
