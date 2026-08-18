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
import TicketCategoryOption from "../ticket-category-options/ticket-category-options.model";
import CategoryOption from "../config/categories/category-options/category-options.model";
import Category from "../config/categories/category/categories.model";
import TicketAssignee from "../ticket-assignees/ticket-assignees.model";

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

  findByIdFull(
  id: string,
  extraOptions?: Omit<FindOptions, "where">,
): Promise<FullTicket | null> {
  return this.model.findOne({
    ...extraOptions,
    where: { id },
    include: [
      { association: "requester" },
      { model: Area, as: "area" },
      { model: Priority, as: "priority" },
      { model: TicketStatus, as: "status" },
      {
        model: TicketAssignee,
        as: "ticketAssignees",
        required: false,
        include: [{ association: "user" }],
      },
      {
        model: TicketCategoryOption,
        as: "ticketCategoryOptions",
        required: false,
        include: [
          {
            model: CategoryOption,
            as: "categoryOption",
            required: false,
            include: [
              {
                model: Category,
                as: "category",
                required: false,
              },
            ],
          },
        ],
      },
    ],
  }) as Promise<FullTicket | null>;
}
}
export default new TicketRepository();