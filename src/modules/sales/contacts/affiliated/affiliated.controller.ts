import { Request, Response } from "express";
import RouterController from "../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../middlewares/auth-token";
import { validateLoginSchema } from "../../../../middlewares/validation";
import { LoginSchema } from "../../../company/users/users/schemas/user.schema";
import affiliatedService from "./affiliated.service";

// Mounted by contacts.controller at /affiliated (no routes file: the loader stops at contacts.routes.ts).
class AffiliatedController extends RouterController {
  constructor() {
    super();

    this.router.post(`/login`, ...this.mw("login"), this.login);
    this.router.get(`/me`, ...this.mw("getMe"), this.getMe);
  }

  protected middlewaresFor() {
    return {
      login: [validateLoginSchema(LoginSchema)],
      getMe: [authenticate],
    };
  }

  // Same token cookie options as user.controller's login.
  login = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { email, password } = req.body;
      const { token, profile } = await affiliatedService.login(email, password);

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 8 * 60 * 60 * 1000,
      });
      return res.json({ user: profile });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getMe = async (req: Request, res: Response): Promise<Response> => {
    try {
      const user = await affiliatedService.getMe(req.cookies.token as string);
      return res.json({ user });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new AffiliatedController();
