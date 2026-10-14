import { CookieOptions, Request, Response } from "express";
import RouterController from "../../../../shared/utils/base-models/base-router-controller";
import { authenticate } from "../../../../middlewares/auth-token";
import { validateLoginSchema } from "../../../../middlewares/validation";
import { LoginSchema } from "../../../company/users/users/schemas/user.schema";
import affiliatedService, { AffiliatedService } from "./affiliated.service";

const TOKEN_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 8 * 60 * 60 * 1000,
};

class AffiliatedController extends RouterController {
  constructor(private readonly service: AffiliatedService) {
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

  login = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { email, password } = req.body;
      const { token, profile } = await this.service.login(email, password);

      res.cookie("token", token, TOKEN_COOKIE_OPTIONS);
      return res.json({ user: profile });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  getMe = async (req: Request, res: Response): Promise<Response> => {
    try {
      const token = req.cookies.token as string;
      const profile = await this.service.getMe(token);

      res.cookie("token", token, TOKEN_COOKIE_OPTIONS);
      return res.json({ user: profile });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new AffiliatedController(affiliatedService);
