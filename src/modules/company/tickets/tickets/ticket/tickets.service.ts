import {
  CreateOptions,
  FindOptions,
  literal,
  Op,
  Transaction,
  WhereOptions,
} from "sequelize";
import sequelize from "../../../../../config/sequelize";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../../shared/query/query.types";
import CategoryOption from "../config/categories/category-options/category-options.model";
import TicketStatus from "../config/ticket-statuses/ticket-statuses.model";
import TicketAssignee from "../ticket-assignees/ticket-assignees.model";
import TicketCategoryOption from "../ticket-category-options/ticket-category-options.model";
import TicketStatusHistory from "../ticket-status-histories/ticket-status-histories.model";
import Ticket from "./tickets.model";
import ticketRepository, { TicketRepository } from "./tickets.repository";
import ticketStatusHistoryService from "../ticket-status-histories/ticket-status-histories.service";
import { FullTicket, DueStatus, TicketTrail } from "./tickets.types";
import  priorityService  from "../config/priorities/priorities.service";
import ticketStatusesService from "../config/ticket-statuses/ticket-statuses.service";
export class TicketService extends BaseService<Ticket, TicketRepository> {
  constructor() {
    super(ticketRepository);
    this.queryConfig = {
      filterableFields: [
        "requester_user_id",
        "area_id",
        "priority_id",
        "status_id",
        "due_status",
      ],
      sortableFields: [
        "title",
        "completed_at",
        "due_status",
        "due_date",
        "createdAt",
        "updatedAt",
      ],
      customSort: {
        due_status: () =>
          literal(`CASE
      WHEN due_status = 'LATE' THEN 0
      WHEN due_status = 'SOON' THEN 1
      WHEN due_status = 'ON_TRACK' THEN 2
      ELSE 3
    END ASC,
    "status"."display_order" ASC,
    due_date ASC`),

        "status.display_order": () => [
          { model: TicketStatus, as: "status" },
          "display_order",
          "ASC",
        ],
      },
      customFields: {
        process: (value) => {
          const status = Array.isArray(value) ? value[0] : value;
          const statusCondition = {
            completed: "completed = true",
            canceled: "canceled = true",
            pending: "completed = false AND canceled = false",
          }[status];

          if (!statusCondition) return {};

          return {
            status_id: {
              [Op.in]: literal(
                `(SELECT id FROM ticket_statuses WHERE ${statusCondition})`,
              ),
            },
          };
        },
        category_id: (value) => {
          const ids = (Array.isArray(value) ? value : [value]).map(Number);
          return {
            id: {
              [Op.in]: literal(`(
          SELECT tco.ticket_id
          FROM ticket_category_options tco
          INNER JOIN category_options co ON co.id = tco.category_option_id
          WHERE co.category_id IN (${ids.join(",")})
        )`),
            },
          };
        },
        category_option_id: (value) => {
          const ids = (Array.isArray(value) ? value : [value]).map(Number);
          return {
            id: {
              [Op.in]: literal(`(
          SELECT tco.ticket_id
          FROM ticket_category_options tco
          WHERE tco.category_option_id IN (${ids.join(",")})
        )`),
            },
          };
        },
      },
      searchFields: ["title", "description"],
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
    };
  }

  private computeDueStatus(
    ticket: Ticket,
    isOpen: boolean,
    now = new Date(),
  ): DueStatus {
    if (!isOpen || !ticket.due_date) return DueStatus.ON_TRACK;

    const diffMs = ticket.due_date.getTime() - now.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (diffMs <= 0) return DueStatus.LATE;
    if (diffMs <= oneDayMs) return DueStatus.SOON;
    return DueStatus.ON_TRACK;
  }

  findByIdFull(id: string, options?: FindOptions): Promise<FullTicket | null> {
    return this.repository.findByIdFull(id, options);
  }

  async create(
    data: Partial<Ticket["_creationAttributes"]>,
    options?: CreateOptions,
  ): Promise<Ticket> {
    const externalTransaction = options?.transaction as Transaction | undefined;
    const transaction = externalTransaction ?? (await sequelize.transaction());
    try {
      if (!data.status_id) {
        const defaultStatus = await TicketStatus.findOne({
          where: { is_default: true },
          transaction,
        });
        
        if (defaultStatus) data.status_id = defaultStatus.id;
        else throw new Error("Nenhum status padrão cadastrado, cadastre um status padrão ou informe o status do chamado!")
      }
      const ticket = await super.create(data, { ...options, transaction });
      if (ticket.status_id) {
        await ticketStatusHistoryService.create(
          {
            ticket_id: ticket.id,
            status_id: ticket.status_id,
            changed_by_user_id: ticket.requester_user_id,
            changed_at: ticket.createdAt,
          },
          { transaction },
        );
      }
      if (!externalTransaction) await transaction.commit();
      return ticket;
    } catch (error) {
      if (!externalTransaction) await transaction.rollback();
      throw error;
    }
  }

  async paginate(params: QueryParams): Promise<PaginatedResult<FullTicket>> {
    await this.refreshDueStatuses();
    return this.paginateWithRelations(params);
  }

  async paginateWithRelations(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    forcedWhere?: WhereOptions,
  ): Promise<PaginatedResult<FullTicket>> {
    await this.refreshDueStatuses();
    return this.repository.paginateWithRelations(
      params,
      this.queryConfig,
      extraOptions,
      forcedWhere,
    );
  }

  async refreshDueStatuses(now = new Date()): Promise<void> {
    const tickets = await Ticket.findAll({
      include: [
        {
          model: TicketStatus,
          as: "status",
          attributes: ["completed", "canceled"],
        },
      ],
    });
    await Promise.all(
      tickets.map(async (ticket) => {
        const status = ticket.get("status") as TicketStatus | undefined;
        const isOpen =
          !ticket.completed_at && !status?.completed && !status?.canceled;
        const dueStatus = this.computeDueStatus(ticket, isOpen, now);

        if (ticket.due_status !== dueStatus)
          await ticket.update({ due_status: dueStatus });
      }),
    );
  }

  async markAsCompleted(
    ticketIds: string[],
    changedByUserId?: string,
  ): Promise<void> {
    const status = await ticketStatusesService.findOne({ where: { completed: true } });
    if (!status) throw new Error("Nenhum status de conclusão cadastrado.");

    await this.changeStatus(ticketIds, status.id, changedByUserId);
  }

  async markAsCanceled(
    ticketIds: string[],
    changedByUserId?: string,
  ): Promise<void> {
    const status = await ticketStatusesService.findOne({ where: { canceled: true } });
    if (!status) throw new Error("Nenhum status de cancelamento cadastrado.");

    await this.changeStatus(ticketIds, status.id, changedByUserId);
  }


  async markAsUrgency(ticketIds: string[]): Promise<void> {
    const priority = await priorityService.findOne({
      order: [["display_order", "ASC"]],
    });
    if (!priority) throw new Error("Nenhuma prioridade cadastrada.");

    await Ticket.update(
      { priority_id: priority.id },
      { where: { id: { [Op.in]: ticketIds } } },
    );
  }

  async changeStatus(
    ticketIds: string | string[],
    statusId: string,
    changedByUserId?: string,
  ): Promise<Ticket[]> {
    const ids = Array.isArray(ticketIds) ? ticketIds : [ticketIds];
    const transaction = await sequelize.transaction();
    try {
      const status = await TicketStatus.findByPk(statusId, { transaction });
      if (!status) throw new Error("Status não encontrado.");

      const now = new Date();
      const completedAt = status.completed || status.canceled ? now : null;
      const isOpen = !completedAt;

      const tickets = await Ticket.findAll({
        where: { id: { [Op.in]: ids } },
        transaction,
      });
      if (tickets.length !== ids.length)
        throw new Error("Ticket não encontrado.");

      await Promise.all(
        tickets.map(async (ticket) => {
          const dueStatus = this.computeDueStatus(ticket, isOpen, now);
          await ticket.update(
            {
              status_id: status.id,
              completed_at: completedAt,
              due_status: dueStatus,
            },
            { transaction },
          );
          await TicketStatusHistory.create(
            {
              ticket_id: ticket.id,
              status_id: status.id,
              changed_by_user_id: changedByUserId ?? null,
              changed_at: now,
            },
            { transaction },
          );
        }),
      );

      await transaction.commit();
      return tickets;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async assignUser(ticketId: string, userId: string): Promise<TicketAssignee> {
    await this.assertTicket(ticketId);
    const [assignment] = await TicketAssignee.findOrCreate({
      where: { ticket_id: ticketId, user_id: userId },
      defaults: { ticket_id: ticketId, user_id: userId },
    });
    return assignment;
  }

  async removeUser(ticketId: string, userId: string): Promise<boolean> {
    return (
      (await TicketAssignee.destroy({
        where: { ticket_id: ticketId, user_id: userId },
      })) > 0
    );
  }

  async addCategoryOption(
    ticketId: string,
    categoryOptionId: string,
  ): Promise<TicketCategoryOption> {
    await this.assertTicket(ticketId);
    if (!(await CategoryOption.findByPk(categoryOptionId)))
      throw new Error("Opção de categoria não encontrada.");
    const [relation] = await TicketCategoryOption.findOrCreate({
      where: { ticket_id: ticketId, category_option_id: categoryOptionId },
      defaults: { ticket_id: ticketId, category_option_id: categoryOptionId },
    });
    return relation;
  }

  async removeCategoryOption(
    ticketId: string,
    categoryOptionId: string,
  ): Promise<boolean> {
    return (
      (await TicketCategoryOption.destroy({
        where: { ticket_id: ticketId, category_option_id: categoryOptionId },
      })) > 0
    );
  }

  async getTaskTrail(ticketId: string): Promise<TicketTrail> {
    const ticket = await Ticket.findByPk(ticketId);
    if (!ticket) throw new Error("Ticket não encontrado.");
    const statusHistory = await TicketStatusHistory.findAll({
      where: { ticket_id: ticketId },
      include: [{ model: TicketStatus, as: "status" }],
      order: [["changed_at", "ASC"]],
    });
    const resolutionTimeHours = ticket.completed_at
      ? Number(
          (
            (ticket.completed_at.getTime() - ticket.createdAt.getTime()) /
            3_600_000
          ).toFixed(2),
        )
      : null;
    const referenceDate = ticket.completed_at ?? new Date();
    const dueDate = ticket.due_date ?? null;
    return {
      ticket,
      statusHistory,
      resolutionTimeHours,
      dueDate,
      exceededDueDate: !!dueDate && referenceDate.getTime() > dueDate.getTime(),
    };
  }

  private async assertTicket(ticketId: string): Promise<void> {
    if (!(await Ticket.findByPk(ticketId)))
      throw new Error("Ticket não encontrado.");
  }
}
export default new TicketService();
