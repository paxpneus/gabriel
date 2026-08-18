import { CreateOptions, Transaction } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../../shared/query/query.types";
import CategoryOption from "../config/categories/category_options/category-options.model";
import Priority from "../config/priorities/priorities.model";
import TicketStatus from "../config/ticket-statuses/ticket-statuses.model";
import TicketAssignee from "../ticket-assignees/ticket-assignees.model";
import TicketCategoryOption from "../ticket-category-options/ticket-category-options.model";
import TicketStatusHistory from "../ticket-status-histories/ticket-status-histories.model";
import Ticket from "./tickets.model";
import ticketRepository, { TicketRepository } from "./tickets.repository";
import ticketStatusHistoryService from "../ticket-status-histories/ticket-status-histories.service";

type TicketTrail = {
  ticket: Ticket;
  statusHistory: TicketStatusHistory[];
  resolutionTimeHours: number | null;
  slaHours: number | null;
  exceededSla: boolean;
};

export class TicketService extends BaseService<Ticket, TicketRepository> {
  constructor() {
    super(ticketRepository);
    this.queryConfig = {
      filterableFields: [
        "requester_user_id",
        "area_id",
        "priority_id",
        "status_id",
        "is_late",
      ],
      sortableFields: [
        "title",
        "completed_at",
        "is_late",
        "createdAt",
        "updatedAt",
      ],
      searchFields: ["title", "description"],
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
    };
  }

  private isPastSla(
    ticket: Ticket,
    slaHours: number | null | undefined,
    now = new Date(),
  ): boolean {
    return (
      !!slaHours &&
      slaHours > 0 &&
      now.getTime() > ticket.createdAt.getTime() + slaHours * 3_600_000
    );
  }

  async create(
    data: Partial<Ticket["_creationAttributes"]>,
    options?: CreateOptions,
  ): Promise<Ticket> {
    const externalTransaction = options?.transaction as Transaction | undefined;
    const transaction = externalTransaction ?? (await sequelize.transaction());
    try {
      const ticket = await super.create(data, { ...options, transaction });
      await ticketStatusHistoryService.create(
        {
          ticket_id: ticket.id,
          status_id: ticket.status_id,
          changed_by_user_id: ticket.requester_user_id,
          changed_at: ticket.createdAt,
        },
        { transaction },
      );
      if (!externalTransaction) await transaction.commit();
      return ticket;
    } catch (error) {
      if (!externalTransaction) await transaction.rollback();
      throw error;
    }
  }

  async paginate(params: QueryParams): Promise<PaginatedResult<Ticket>> {
    await this.refreshLateTickets();
    return super.paginate(params);
  }

  /** Atualiza a flag persistida somente em tickets que ainda estão abertos. */
  async refreshLateTickets(now = new Date()): Promise<void> {
    const tickets = await Ticket.findAll({
      include: [
        { model: Priority, as: "priority", attributes: ["sla_hours"] },
        {
          model: TicketStatus,
          as: "status",
          attributes: ["completed", "canceled"],
        },
      ],
    });
    await Promise.all(
      tickets.map(async (ticket) => {
        const priority = ticket.get("priority") as Priority | undefined;
        const status = ticket.get("status") as TicketStatus | undefined;
        const isOpen =
          !ticket.completed_at && !status?.completed && !status?.canceled;
        const isLate =
          isOpen && this.isPastSla(ticket, priority?.sla_hours, now);
        if (ticket.is_late !== isLate) await ticket.update({ is_late: isLate });
      }),
    );
  }

  async changeStatus(
    ticketId: string,
    statusId: number,
    changedByUserId?: string,
  ): Promise<Ticket> {
    const transaction = await sequelize.transaction();
    try {
      const [ticket, status] = await Promise.all([
        Ticket.findByPk(ticketId, { transaction }),
        TicketStatus.findByPk(statusId, { transaction }),
      ]);
      if (!ticket) throw new Error("Ticket não encontrado.");
      if (!status) throw new Error("Status não encontrado.");
      const now = new Date();
      const completedAt = status.completed || status.canceled ? now : null;
      const priority = await Priority.findByPk(ticket.priority_id, {
        transaction,
      });
      const isLate =
        !completedAt && this.isPastSla(ticket, priority?.sla_hours, now);
      await ticket.update(
        { status_id: status.id, completed_at: completedAt, is_late: isLate },
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
      await transaction.commit();
      return ticket;
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
    categoryOptionId: number,
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
    categoryOptionId: number,
  ): Promise<boolean> {
    return (
      (await TicketCategoryOption.destroy({
        where: { ticket_id: ticketId, category_option_id: categoryOptionId },
      })) > 0
    );
  }

  async getTaskTrail(ticketId: string): Promise<TicketTrail> {
    const ticket = await Ticket.findByPk(ticketId, {
      include: [{ model: Priority, as: "priority", attributes: ["sla_hours"] }],
    });
    if (!ticket) throw new Error("Ticket não encontrado.");
    const statusHistory = await TicketStatusHistory.findAll({
      where: { ticket_id: ticketId },
      include: [{ model: TicketStatus, as: "status" }],
      order: [["changed_at", "ASC"]],
    });
    const priority = ticket.get("priority") as Priority | undefined;
    const resolutionTimeHours = ticket.completed_at
      ? Number(
          (
            (ticket.completed_at.getTime() - ticket.createdAt.getTime()) /
            3_600_000
          ).toFixed(2),
        )
      : null;
    const elapsedHours =
      ((ticket.completed_at ?? new Date()).getTime() -
        ticket.createdAt.getTime()) /
      3_600_000;
    const slaHours = priority?.sla_hours ?? null;
    return {
      ticket,
      statusHistory,
      resolutionTimeHours,
      slaHours,
      exceededSla: !!slaHours && elapsedHours > slaHours,
    };
  }

  private async assertTicket(ticketId: string): Promise<void> {
    if (!(await Ticket.findByPk(ticketId)))
      throw new Error("Ticket não encontrado.");
  }
}
export default new TicketService();
