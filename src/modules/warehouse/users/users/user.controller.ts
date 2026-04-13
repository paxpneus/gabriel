import BaseController from "../../../../shared/utils/base-models/base-controller";
import User from "./user.model";
import UserService from "./user.service";
import {
  validateCreate,
  validateUpdate,
  validateId,
  validateLoginSchema,
} from "../../../../middlewares/validation";
import {
  CreateUserSchema,
  UpdateUserSchema,
  UserIdSchema,
  LoginSchema,
} from "../../../../shared/schemas";
import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";

export class UserController extends BaseController<User, typeof UserService> {
  constructor() {
    super(UserService);

    this.router.post(`/login`, this.login);

    this.router.post(`/logout`, this.logout);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate],
      create: [validateCreate(CreateUserSchema)],
      update: [
        authenticate,
        validateId(UserIdSchema),
        validateUpdate(UpdateUserSchema),
      ],
      show: [authenticate, validateId(UserIdSchema)],
      destroy: [authenticate, validateId(UserIdSchema)],
      login: [validateLoginSchema(LoginSchema)],
    };
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.createUserWithValidation(req.body);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.updateUserWithValidation(
        req.params.id as string,
        req.body,
      );
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  login = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { email, password } = req.body;

      const { token, user } = await this.service.login(email, password);

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 8 * 60 * 60 * 1000,
      });
      return res.json({ user });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  logout = async (req: Request, res: Response): Promise<Response> => {
    res.clearCookie("token");
    return res.json({ message: "Logout realizado" });
  };
}

export default new UserController();
