import { Request, Response } from "express";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController from "../../../shared/utils/base-models/base-controller";
import Application from "./applications.model";
import applicationService, {
  ApplicationService,
} from "./applications.service";

class ApplicationController extends BaseController<
  Application,
  ApplicationService
> {
  constructor() {
    super(applicationService);

    this.router.post("/login", this.login);
    this.router.post(
      "/:id/revoke-token",
      ...this.mw("revokeTokens"),
      this.revokeTokens,
    );
    this.router.post(
      "/:id/rotate-secret",
      ...this.mw("rotateSecret"),
      this.rotateSecret,
    );
    this.router.get(
      "/metadata/allowed-routes",
      ...this.mw("allowedRoutes"),
      this.allowedRoutes,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      revokeTokens: [authenticate, userPermissions],
      rotateSecret: [authenticate, userPermissions],
      allowedRoutes: [authenticate, userPermissions],
    };
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.createApplication(req.body);
      return res.status(201).json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  login = async (req: Request, res: Response): Promise<Response> => {
    try {
      const result = await this.service.login(req.body);
      return res.json(result);
    } catch (error: any) {
      return res.status(401).json({ error: error.message });
    }
  };

  revokeTokens = async (req: Request, res: Response): Promise<Response> => {
    try {
      const application = await this.service.revokeTokens(req.params.id as string);
      return res.json({ message: "Token revogado com sucesso", application });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  rotateSecret = async (req: Request, res: Response): Promise<Response> => {
    try {
      const credentials = await this.service.rotateSecret(req.params.id as string);
      return res.json({ credentials });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  allowedRoutes = async (_req: Request, res: Response): Promise<Response> => {
    try {
      return res.json({ routes: this.service.getAllowedApiRoutes() });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new ApplicationController();
