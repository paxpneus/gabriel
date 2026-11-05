import { Request, Response } from "express";
import { Op } from "sequelize";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import UnitBusinessGroup from "./unit-business-group.model";
import UnitBusinessGroupService from "./unit-business-group.service";
import { UnitBusinessGroupInUseError } from "./unit-business-group.types";

export class UnitBusinessGroupController extends BaseController<
  UnitBusinessGroup,
  typeof UnitBusinessGroupService
> {
  constructor() {
    super(UnitBusinessGroupService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
      bulkUpdate: [authenticate, userPermissions],
    };
  }

  // Destroy/bulkDestroy do BaseController com 409 quando o grupo está em período de gerente; resto igual.
  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const deleted = await this.service.delete(req.params.id as string);
      if (!deleted) return res.status(404).json({ error: "Não encontrado" });
      return res.status(204).send();
    } catch (error: any) {
      if (error instanceof UnitBusinessGroupInUseError) return res.status(409).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  };

  bulkDestroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Informe um array de ids válido." });
      }
      const deleted = await this.service.bulkDelete({ where: { id: { [Op.in]: ids } } });
      return res.json({ deleted });
    } catch (error: any) {
      if (error instanceof UnitBusinessGroupInUseError) return res.status(409).json({ error: error.message });
      return res.status(500).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.getFullById(String(req.params.id));
      if (!record) return res.status(404).json({ error: "Grupo não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new UnitBusinessGroupController();
