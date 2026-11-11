import BaseService from "../../../../shared/utils/base-models/base-service";
import User from "./user.model";
import userRepository, { UserRepository } from "./user.repository";
import { CreateUserInput, UpdateUserInput } from "./schemas/user.schema";
import bcrypt from "bcrypt";
import "dotenv/config";
import jwt from "jsonwebtoken";
import Role from "../roles/role.model";
import roleService from "../roles/role.service";
const SECRET = process.env.JWT_SECRET!;
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../../shared/query/query.types";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import UnitBusiness from "../../unit-business/unit-business.model";
import { DestroyOptions, FindOptions, Transaction, UniqueConstraintError } from "sequelize";
import redisService from "../../../../shared/utils/base-models/base-redis";
import UserConfig from "../user_config/user_config.model";
import UserUnitBusiness from "../user_unit_business/user_unit_business.model";
import sequelize from "../../../../config/sequelize";
import { AFFILIATED_USER_TYPE, FULL_ACCESS_USER_TYPES, USER_TYPES } from "../../../../shared/constants/user-types";
import Contact from "../../../sales/contacts/contacts.model";
import { UserAttributes } from "./user.types";
import { UserType } from "../user_config/user_config.types";

// Vida do JWT de usuário (8h); também TTL da marca de revogação por troca de senha.
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const tokenRevokedKey = (userId: string) => `user-token-revoked-before:${userId}`;

// Força bruta: 5 erros de senha por e-mail travam o login por 5 min (contador zera no login certo).
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_SECONDS = 5 * 60;
const loginAttemptsKey = (email: string) => `login-attempts:${String(email ?? "").trim().toLowerCase()}`;
// Mesma mensagem pra e-mail inexistente e senha errada: não revela quais e-mails têm conta.
const INVALID_CREDENTIALS = "E-mail ou senha inválidos";

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

  // Optional outer transaction lets callers (contacts /with-user) create User + Contact atomically.
  async createUserWithValidation(
    userDto: CreateUserInput,
    transaction?: Transaction,
  ): Promise<User> {
    try {
      const run = async (t: Transaction) => {
        const { type, ...userData } = userDto;

        const existingUser = await this.repository.findOne({
          where: { email: userData.email },
          transaction: t,
        });
        if (existingUser) {
          throw new Error("Usuário com este email já existe");
        }

        const cpfExists = await this.repository.findOne({
          where: { cpf: userData.cpf },
          transaction: t,
        });
        if (cpfExists) {
          throw new Error("Usuário com este CPF já existe");
        }

        userData.cpf = cleanDocument(userData.cpf);

        const user = await this.repository.create(userData, { transaction: t });

        await UserConfig.create(
          {
            user_id: user.id,
            ...(type !== undefined && { type }),
          },
          { transaction: t },
        );

        if (
          userData.user_unit_business &&
          userData.user_unit_business?.length > 1
        ) {
          let unitBusinessPayload = userData.user_unit_business?.map((v) => ({
            user_id: user.id,
            unit_business_id: v,
          }));

          if (
            !unitBusinessPayload
              .map((s) => s.unit_business_id)
              .includes(userData.unit_business_id)
          ) {
            unitBusinessPayload = [
              ...unitBusinessPayload,
              {
                user_id: user.id,
                unit_business_id: userData.unit_business_id,
              },
            ];
          }

          await UserUnitBusiness.bulkCreate(unitBusinessPayload, {
            transaction: t,
          });
        } else {
          await UserUnitBusiness.create(
            {
              user_id: user.id,
              unit_business_id: user.unit_business_id,
            },
            { transaction: t },
          );
        }

        return user;
      };

      return await (transaction ? run(transaction) : sequelize.transaction(run));
    } catch (err: any) {
      if (err instanceof UniqueConstraintError) {
        const field = err.errors?.[0]?.path;
        if (field === "email")
          throw new Error("Usuário com este email já existe");
        if (field === "cpf") throw new Error("Usuário com este CPF já existe");
        throw new Error("Dados duplicados, verifique email ou CPF");
      }
      throw err;
    }
  }

  // Transação externa opcional: contacts /:id/with-user atualiza User + Contact juntos. `active` só vem dessa rota (bloqueio do login).
  async updateUserWithValidation(
    userId: string,
    userDto: Partial<UpdateUserInput> & { active?: boolean },
    transaction?: Transaction,
  ): Promise<User | null> {
    const userCached = await redisService.get(`user:${userId}`);
    if (userCached) await redisService.delete(`user:${userId}`);

    const run = async (t: Transaction) => {
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
        id_system,
        type,
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
        ...(type !== undefined && { type }),
        ...config,
      };

      if (userDto.email) {
        const existingUser = await this.repository.findOne({
          where: { email: userDto.email },
          transaction: t,
        });
        if (existingUser && existingUser.id !== userId) {
          throw new Error("Outro usuário já possui este email");
        }
      }

      if (userDto.cpf) {
        const cpfExists = await this.repository.findOne({
          where: { cpf: userDto.cpf },
          transaction: t,
        });
        if (cpfExists && cpfExists.id !== userId) {
          throw new Error("Outro usuário já possui este CPF");
        }
      }

      const updated = await this.repository.update(
        userId,
        {
          ...userPayload,
          ...(id_system !== undefined && { id_system }),
        },
        { transaction: t },
      );

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
        if (
          userDto.unit_business_id &&
          !incoming.includes(userDto.unit_business_id)
        ) {
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
            toAdd.map((unit_business_id) => ({
              user_id: userId,
              unit_business_id,
            })),
            { transaction: t },
          );
        }
      }

      return updated;
    };

    const updated = await (transaction ? run(transaction) : sequelize.transaction(run));
    // Limpa de novo depois de gravar: request concorrente pode ter recacheado o usuário antigo (active/senha) no meio.
    await redisService.delete(`user:${userId}`);
    if (userDto.password) await this.revokeTokens(userId);
    return updated;
  }

  // Soft delete: só desativa (bloqueia login), não apaga a linha. Cache limpo: o authenticate barra a sessão aberta.
  async delete(id: string, options?: DestroyOptions): Promise<boolean> {
    const updated = await this.repository.update(
      id,
      { active: false } as Partial<User["_creationAttributes"]>,
      options,
    );
    await redisService.delete(`user:${id}`);
    return !!updated;
  }

  async bulkDelete(options: DestroyOptions): Promise<number> {
    const users = await this.repository.findAll({
      where: options.where ?? {},
      attributes: ["id"],
      transaction: options.transaction,
    });
    const [count] = await this.repository.bulkUpdate(
      { active: false } as Partial<User["_creationAttributes"]>,
      { where: options.where ?? {}, transaction: options.transaction },
    );
    await Promise.all(users.map((user) => redisService.delete(`user:${user.id}`)));
    return count;
  }

  // Troca de senha: token emitido antes de agora deixa de valer (TTL = vida do JWT, depois disso ele já expirou).
  async revokeTokens(userId: string): Promise<void> {
    await redisService.set(tokenRevokedKey(userId), Math.floor(Date.now() / 1000), {
      mode: "EX",
      duration: TOKEN_TTL_SECONDS,
    });
  }

  // Sessão de usuário (authenticate): recusa token anterior à última troca de senha e usuário desativado.
  async assertActiveSession(userId: string, issuedAt?: number): Promise<void> {
    const revokedBefore = await redisService.get<number>(tokenRevokedKey(userId));
    if (revokedBefore && (issuedAt ?? 0) < Number(revokedBefore)) {
      throw new Error("Sessão encerrada, faça login novamente");
    }

    const user = await this.findCachedUser(userId);
    if (!user || user.active === false) throw new Error("Usuário desativado");
  }

  // Usuário completo sem o hash, do cache user:<id> (mesmo do getMe/userPermissions) ou do banco, recacheando.
  private async findCachedUser(userId: string) {
    const cachedUser = await redisService.get<UserAttributes>(`user:${userId}`);
    if (cachedUser) {
      // Cache gravado antes de getFullUser expor `type` no topo (e antes de tirar o hash da senha).
      const { password: _cachedPassword, ...safeCached } = cachedUser;
      return { ...safeCached, type: cachedUser.type ?? cachedUser.config?.type ?? null };
    }

    const user = await this.repository.getFullUser({ where: { id: userId } });
    if (!user) return null;

    // Hash da senha não vai pro cache nem pra resposta.
    const { password: _password, ...safeUser } = user;
    await redisService.set(`user:${userId}`, safeUser);
    return safeUser;
  }

  private async assertUnitBusinessAccess(
    user: UserAttributes,
    unitBusinessId: string,
  ): Promise<void> {
    const isAdmin = await roleService.isAdminRole(user.role_id);
    const hasAccess =
      isAdmin ||
      user.availableUnitBusinesses?.some((ub) => ub.id === unitBusinessId);

    if (!hasAccess) {
      throw new Error("Usuário não tem acesso a essa unidade de negócio");
    }
  }

  async switchUnitBusiness(
    userId: string,
    unitBusinessId: string,
  ): Promise<UserAttributes> {
    const user = await this.repository.getFullUser({ where: { id: userId } });
    if (!user) throw new Error("Usuário não encontrado");

    await this.assertUnitBusinessAccess(user, unitBusinessId);

    await this.repository.update(userId, {
      unit_business_id: unitBusinessId,
    });
    await redisService.delete(`user:${userId}`);

    const updated = await this.repository.getFullUser({
      where: { id: userId },
    });
    if (!updated) throw new Error("Usuário não encontrado");

    return updated;
  }

  // Shared by login/loginAs: rate limit por e-mail, loads the full user, checks the bcrypt password and blocks inactive.
  private async verifyCredentials(email: string, password: string): Promise<UserAttributes> {
    const attemptsKey = loginAttemptsKey(email);
    const attempts = Number((await redisService.get<number>(attemptsKey)) ?? 0);
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      throw Object.assign(new Error("Muitas tentativas de login. Tente novamente em 5 minutos."), { status: 429 });
    }

    const user = await this.repository.getFullUser({
      where: { email },
    });

    const validPassword = user ? await bcrypt.compare(password, user.password) : false;
    if (!user || !validPassword) {
      // Janela de 5 min começa no 1º erro (EXPIRE só quando o contador nasce).
      const count = await redisService.client.incr(attemptsKey);
      if (count === 1) await redisService.client.expire(attemptsKey, LOGIN_LOCK_SECONDS);
      throw new Error(INVALID_CREDENTIALS);
    }

    // Desativado só depois da senha certa: antes disso a resposta é a mesma de credencial inválida.
    if (user.active === false) throw new Error("Usuário desativado");

    await redisService.delete(attemptsKey);
    return user;
  }

  // 8h JWT carrying id + role, same payload getMe/authenticate decode.
  private signToken(user: UserAttributes): string {
    return jwt.sign({ id: user.id, role: user.role_id }, SECRET, {
      expiresIn: TOKEN_TTL_SECONDS,
    });
  }

  async login(email: string, password: string, unitBusinessToJoin?: string) {
    let user = await this.verifyCredentials(email, password);

    // Affiliates have their own login (/api/contacts/affiliated/login) and no hub modules.
    if (user.type === AFFILIATED_USER_TYPE) {
      throw new Error("Afiliados devem acessar pelo login de afiliado");
    }

    if (unitBusinessToJoin && unitBusinessToJoin !== user.unit_business_id) {
      await this.assertUnitBusinessAccess(user, unitBusinessToJoin);

      await this.repository.update(user.id, {
        unit_business_id: unitBusinessToJoin,
      });
      await redisService.delete(`user:${user.id}`);
      const refreshed = await this.repository.getFullUser({ where: { email } });
      if (!refreshed) throw new Error("Usuário não encontrado");
      user = refreshed;
    }

    const token = this.signToken(user);

    // Hash da senha só serve pro compare acima — nunca vai na resposta.
    const { password: _password, ...safeUser } = user;
    return { token, user: safeUser };
  }

  // Escopo de tenant das rotas que recebem integrations_id: a integração tem que ser de alguma loja do usuário
  // (atual ou vinculada); admin/developer passam em qualquer uma.
  async assertIntegrationAccess(userId: string, integrationsId: string): Promise<void> {
    const user = await this.repository.getFullUser({ where: { id: userId } });
    if (!user) throw new Error("Usuário não encontrado");
    if (FULL_ACCESS_USER_TYPES.includes(user.config?.type as any)) return;

    // Fora admin/developer, a loja atual sempre está entre as vinculadas (login/troca de loja exigem isso).
    if (!(user.availableUnitBusinesses ?? []).some((ub) => ub.integrations_id === integrationsId)) {
      throw new Error("Você não tem acesso a essa integração");
    }
  }

  // Login restricted to one user type (e.g. the affiliated login route).
  async loginAs(email: string, password: string, userType: UserType) {
    const user = await this.verifyCredentials(email, password);

    if (user.type !== userType) throw new Error("Usuário sem acesso a este login");

    // Mesmo corte do login: o hash não sai daqui.
    const { password: _password, ...safeUser } = user;
    return { token: this.signToken(user), user: safeUser };
  }

  async getMe(token: string) {
    if (!token) throw new Error("Token não informado");

    const decoded = jwt.verify(token, SECRET) as {
      id: string;
      role: string;
    };

    const user = await this.findCachedUser(decoded.id);
    if (!user) throw new Error("Usuário não encontrado");
    return user;
  }
}

export default new UserService();
