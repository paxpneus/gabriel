import { Request, Response } from "express";
import BaseController from "../../../shared/utils/base-models/base-controller";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import UnmappedEntity from "./unmapped-entity.model";
import UnmappedEntityService from "./unmapped-entity.service";
import { getRequestUserId } from "../../../shared/query/get-logged-user";
import { assertUuid } from "../../../shared/utils/validators/uuid";

// Pendência só nasce do sync e só sai mapeada (POST /:id/map); CRUD genérico de escrita fica bloqueado.
const PENDING_IS_READ_ONLY_MESSAGE =
  "Pendências de mapeamento só podem ser resolvidas mapeando (POST /:id/map).";

export class UnmappedEntityController extends BaseController<
  UnmappedEntity,
  typeof UnmappedEntityService
> {
  constructor() {
    super(UnmappedEntityService);

    this.router.post("/:id/map", ...this.mw("map"), this.map);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      // Mapear = criar o integration_mapping: permissão de escrita da entidade.
      map: [authenticate, userPermissions],
    };
  }

  // POST /:id/map — body { internal_id }: cria o integration_mapping e remove a pendência.
  map = async (req: Request, res: Response): Promise<Response> => {
    try {
      const mapping = await this.service.map(
        assertUuid(req.params.id, "Pendência"),
        assertUuid(req.body?.internal_id, "Registro do sistema"),
        getRequestUserId(req),
      );
      if (!mapping) return res.status(404).json({ error: "Pendência não encontrada" });
      return res.status(201).json(mapping);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  create = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };

  bulkCreate = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };

  update = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };

  bulkUpdate = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };

  destroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };

  bulkDestroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: PENDING_IS_READ_ONLY_MESSAGE });
  };
}

export default new UnmappedEntityController();
