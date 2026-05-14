import BaseService from "../../../../shared/utils/base-models/base-service";
import User from "./user.model";
import userRepository, { UserRepository } from "./user.repository";
import { CreateUserInput, UpdateUserInput } from "../../../../shared/schemas";
import bcrypt from "bcrypt";
import "dotenv/config";
import jwt from "jsonwebtoken";
import Role from "../roles/role.model";
const SECRET = process.env.JWT_SECRET!;
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../../shared/query/query.types";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import UnitBusiness from "../../unit-business/unit-business.model";
import { FindOptions, UniqueConstraintError } from "sequelize";
import redisService from "../../../../shared/utils/base-models/base-redis";
import UserConfig from "../user_config/user_config.model";
import UserUnitBusiness from "../user_unit_business/user_unit_business.model";
import sequelize from "../../../../config/sequelize";

export class UserService extends BaseService<User, UserRepository> {
  constructor() {
    super(userRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["name", "email"],
      filterableFields: ["role", "status", "unit_business_id"],
      sortableFields: ["name", "email", "createdAt", "updatedAt"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<User>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: Role,
          as: "role",
        },
        {
          model: UnitBusiness,
          as: "unitBusiness",
        },
        {
          model: UserConfig,
          as: "config",
        },
      ],
    });
  }

  async createUserWithValidation(userDto: CreateUserInput): Promise<User> {
    try {
    return await sequelize.transaction(async (t) => {
    const existingUser = await this.repository.findOne({
      where: { email: userDto.email }, transaction: t
    });
    if (existingUser) {
      throw new Error("Usuário com este email já existe");
    }

    const cpfExists = await this.repository.findOne({
      where: { cpf: userDto.cpf },
      transaction: t
    });
    if (cpfExists) {
      throw new Error("Usuário com este CPF já existe");
    }

    userDto.cpf = cleanDocument(userDto.cpf);

    const user = await this.repository.create(userDto, {transaction: t});
    await UserConfig.create({ user_id: user.id }, {transaction: t});

    if (userDto.user_unit_business && userDto.user_unit_business?.length > 1) {

      let unitBusinessPayload = userDto.user_unit_business?.map((v) => ({
      user_id: user.id,
      unit_business_id: v,
    }));

    if (!unitBusinessPayload.map((s) => s.unit_business_id).includes(userDto.unit_business_id)) {
    unitBusinessPayload = [
      ...unitBusinessPayload,
      {
        user_id: user.id,
        unit_business_id: userDto.unit_business_id
      }
    ]
  }

    await UserUnitBusiness.bulkCreate(unitBusinessPayload, {transaction: t})

    } else {
      await UserUnitBusiness.create({
      user_id: user.id,
      unit_business_id: user.unit_business_id,
    }, {transaction: t});

    }

    return user;
 
    })
  } catch (err: any) {
    if (err instanceof UniqueConstraintError) {
      // Identifica qual campo violou a constraint
      const field = err.errors?.[0]?.path;
      if (field === 'email') throw new Error("Usuário com este email já existe");
      if (field === 'cpf') throw new Error("Usuário com este CPF já existe");
      throw new Error("Dados duplicados, verifique email ou CPF");
    }
    throw err;
  }
    
  }

  async updateUserWithValidation(
  userId: string,
  userDto: UpdateUserInput,
): Promise<User | null> {
  const userCached = await redisService.get(`user:${userId}`);
  if (userCached) await redisService.delete(`user:${userId}`);

  return await sequelize.transaction(async (t) => {
    const {
      config,
      user_unit_business,
      theme,
      profile_photo,
      language,
      timezone,
      items_per_page,
      notifications_enabled,
      visualize_only_current_unit_business,
      compact_mode,
      ...userPayload
    } = userDto;

    const configPayload = {
      ...(theme !== undefined && { theme }),
      ...(profile_photo !== undefined && { profile_photo }),
      ...(language !== undefined && { language }),
      ...(timezone !== undefined && { timezone }),
      ...(items_per_page !== undefined && { items_per_page }),
      ...(notifications_enabled !== undefined && { notifications_enabled }),
      ...(visualize_only_current_unit_business !== undefined && {
        visualize_only_current_unit_business,
      }),
      ...(compact_mode !== undefined && { compact_mode }),
      ...config,
    };

    if (userDto.email) {
      const existingUser = await this.repository.findOne({ where: { email: userDto.email } });
      if (existingUser && existingUser.id !== userId) {
        throw new Error("Outro usuário já possui este email");
      }
    }

    if (userDto.cpf) {
      const cpfExists = await this.repository.findOne({ where: { cpf: userDto.cpf } });
      if (cpfExists && cpfExists.id !== userId) {
        throw new Error("Outro usuário já possui este CPF");
      }
    }

    const updated = await this.repository.update(userId, userPayload, { transaction: t });

    if (Object.keys(configPayload).length) {
      const [updatedConfigs] = await UserConfig.update(configPayload, {
        where: { user_id: userId },
        transaction: t,
      });

      if (!updatedConfigs) {
        await UserConfig.create(
          { user_id: userId, ...configPayload },
          { transaction: t },
        );
      }
    }

    if (user_unit_business) {
      let incoming = [...user_unit_business];
      if (userDto.unit_business_id && !incoming.includes(userDto.unit_business_id)) {
        incoming.push(userDto.unit_business_id);
      }

      const current = await UserUnitBusiness.findAll({
        where: { user_id: userId },
        transaction: t,
      });

      const currentIds = current.map((r) => r.unit_business_id);
      const toAdd = incoming.filter((id) => !currentIds.includes(id));
      const toRemove = currentIds.filter((id) => !incoming.includes(id));

      if (toRemove.length) {
        await UserUnitBusiness.destroy({
          where: { user_id: userId, unit_business_id: toRemove },
          transaction: t,
        });
      }

      if (toAdd.length) {
        await UserUnitBusiness.bulkCreate(
          toAdd.map((unit_business_id) => ({ user_id: userId, unit_business_id })),
          { transaction: t },
        );
      }
    }

    return updated;
  });
}

  async login(email: string, password: string) {
    const user = await this.repository.findOne({
      where: { email },
      include: [
        {
          model: Role,
          as: "role",
        },
      ],
    });

    if (!user) throw new Error("Usuário não encontrado");

    const incorrectPassword = await bcrypt.compare(password, user.password);
    if (!incorrectPassword) throw new Error("Senha Incorreta");

    const token = jwt.sign({ id: user.id, role: user.role_id }, SECRET, {
      expiresIn: "8h",
    });

    return { token, user };
  }

  async getMe(token: string) {
    if (!token) throw new Error("Token não informado");

    const decoded = jwt.verify(token, SECRET) as {
      id: string;
      role: string;
    };
    let user;

    const cachedUser = await redisService.get(`user:${decoded.id}`);
    if (cachedUser) {
      user = cachedUser;
      return user;
    }

    user = await this.repository.findOne({
      where: { id: decoded.id },
      include: [
        {
          model: Role,
          as: "role",
        },
        {
          model: UnitBusiness,
          as: "unitBusiness",
          attributes: ['id', 'name', 'number', 'id_system']
        },
        {
          model: UnitBusiness,
          as: "availableUnitBusinesses",
          attributes: ['id', 'name', 'number', 'id_system']
        },
        {
          model: UserConfig,
          as: "config",
        },
      ],
    });

    if (!user) throw new Error("Usuário não encontrado");

    const plainUser = user.get({ plain: true });
    const unitBusiness = plainUser.config!.visualize_only_current_unit_business
      ? plainUser.unit_business_id
      : plainUser.availableUnitBusinesses;

    const userWithBusinessToView = {
      ...plainUser,
      businessToView: unitBusiness
    }

    await redisService.set(`user:${decoded.id}`, userWithBusinessToView);

    return userWithBusinessToView;
  }
}

export default new UserService();
