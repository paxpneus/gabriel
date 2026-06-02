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
    this.router.get(
      "/metadata/allowed-routes",
      ...this.mw("allowedRoutes"),
      this.allowedRoutes,
    );
    this.router.post(
      "/clean-timeout/post",
      ...this.mw("cleanTimeOutByIp"),
      this.cleanTimeOutByIp,
    );
    this.router.get(
      "/ban-time/get",
      ...this.mw("getBanTimeRemaining"),
      this.getBanTimeRemaining,
    );

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

    this.router.post("/test-webhook/post", [], this.testWebhook)
    
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
      cleanTimeOutByIp: [authenticate, userPermissions],
      getBanTimeRemaining: [authenticate, userPermissions],
      
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

  testWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log(req.body)
      return res.status(201).json('ok');
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

  cleanTimeOutByIp = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ip = this.getClientIp(req);
      await this.service.cleanTimeOutByIp(ip);
      return res.json({ message: "Ban removido com sucesso" });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getBanTimeRemaining = async (req: Request, res: Response): Promise<Response> => {
    try {
      const ip = this.getClientIp(req);
      const banTime = await this.service.getBanTimeRemaining(ip);
      return res.json( banTime );
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  private getClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
      return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  }

  allowedRoutes = async (_req: Request, res: Response): Promise<Response> => {
    try {
      return res.json({ routes: this.service.getAllowedApiRoutes() });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new ApplicationController();
