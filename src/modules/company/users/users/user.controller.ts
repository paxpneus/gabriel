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
  SwitchUnitBusinessSchema,
} from "../../../../shared/schemas";
import { Request, Response } from "express";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import redisService from "../../../../shared/utils/base-models/base-redis";

export class UserController extends BaseController<User, typeof UserService> {
  constructor() {
    super(UserService);

    this.router.post(`/login`, ...this.mw("login"), this.login);

    this.router.post(`/logout`, this.logout);

    this.router.get('/me/get', ...this.mw('getMe'), this.getMe)

    this.router.put(
      '/me/unit-business',
      ...this.mw('switchUnitBusiness'),
      this.switchUnitBusiness,
    )
  }

   protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, validateCreate(CreateUserSchema), userPermissions],
      update: [
        authenticate,
        validateId(UserIdSchema),
        validateUpdate(UpdateUserSchema),
        userPermissions
      ],
      show: [authenticate, validateId(UserIdSchema), userPermissions],
      destroy: [authenticate, validateId(UserIdSchema), userPermissions],
      login: [validateLoginSchema(LoginSchema)],
      getMe: [authenticate],
      switchUnitBusiness: [
        authenticate,
        validateUpdate(SwitchUnitBusinessSchema),
      ],
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
      const { email, password, unit_business_to_join } = req.body;

      const { token, user } = await this.service.login(
        email,
        password,
        unit_business_to_join,
      );

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

   getMe = async (req: Request, res: Response): Promise<Response> => {
    try {
      const token = req.cookies.token

      const  user = await this.service.getMe(token as string);

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

  switchUnitBusiness = async (req: Request, res: Response): Promise<Response> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Não autenticado" });

      const { unit_business_id } = req.body;

      const user = await this.service.switchUnitBusiness(
        userId,
        unit_business_id,
      );

      return res.json(user);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  logout = async (req: Request, res: Response): Promise<Response> => {
    const {userId} = req.body
    res.clearCookie("token");
    await redisService.delete(`user:${userId}`)
    return res.json({ message: "Logout realizado" });
  };
}

export default new UserController();
