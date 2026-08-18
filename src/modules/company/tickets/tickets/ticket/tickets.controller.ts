import { Request, Response } from "express";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import Ticket from "./tickets.model";
import ticketService, { TicketService } from "./tickets.service";

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    role: string;
  };
};

export class TicketController extends BaseController<Ticket, TicketService> {
  constructor() {
    super(ticketService);

    this.router.patch(
      "/:id/status",
      ...this.mw("changeStatus"),
      this.changeStatus,
    );

    this.router.post(
      "/:id/assignees",
      ...this.mw("assignUser"),
      this.assignUser,
    );

    this.router.delete(
      "/:id/assignees/:userId",
      ...this.mw("removeUser"),
      this.removeUser,
    );

    this.router.post(
      "/:id/category-options",
      ...this.mw("addCategoryOption"),
      this.addCategoryOption,
    );

    this.router.delete(
      "/:id/category-options/:categoryOptionId",
      ...this.mw("removeCategoryOption"),
      this.removeCategoryOption,
    );

    this.router.get(
      "/:id/trail",
      ...this.mw("getTaskTrail"),
      this.getTaskTrail,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      changeStatus: [authenticate, userPermissions],
      assignUser: [authenticate, userPermissions],
      removeUser: [authenticate, userPermissions],
      addCategoryOption: [authenticate, userPermissions],
      removeCategoryOption: [authenticate, userPermissions],
      getTaskTrail: [authenticate, userPermissions],
    };
  }

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.findByIdFull(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const result = await this.service.paginateWithRelations(params);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  changeStatus = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const { statusId } = req.body;
      const changedByUserId = (req as AuthenticatedRequest).user?.id;

      if (!statusId) {
        return res.status(400).json({ error: "Erro: statusId não informado" });
      }

      const ticket = await this.service.changeStatus(
        id as string,
        statusId,
        changedByUserId,
      );

      return res.json(ticket);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  assignUser = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "Erro: userId não informado" });
      }

      const assignment = await this.service.assignUser(id as string, userId);

      return res.json(assignment);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  removeUser = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id, userId } = req.params;

      const removed = await this.service.removeUser(
        id as string,
        userId as string,
      );

      if (!removed) {
        return res.status(404).json({ error: "Atribuição não encontrada" });
      }

      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  addCategoryOption = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { id } = req.params;
      const { categoryOptionId } = req.body;

      if (!categoryOptionId) {
        return res
          .status(400)
          .json({ error: "Erro: categoryOptionId não informado" });
      }

      const relation = await this.service.addCategoryOption(
        id as string,
        categoryOptionId,
      );

      return res.json(relation);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  removeCategoryOption = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { id, categoryOptionId } = req.params;

      const removed = await this.service.removeCategoryOption(
        id as string,
        categoryOptionId as string,
      );

      if (!removed) {
        return res
          .status(404)
          .json({ error: "Opção de categoria não encontrada no ticket" });
      }

      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  getTaskTrail = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { id } = req.params;

      const trail = await this.service.getTaskTrail(id as string);

      return res.json(trail);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new TicketController();
