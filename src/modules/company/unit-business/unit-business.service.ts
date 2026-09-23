import { FindOptions, Op, Transaction } from "sequelize";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import BaseService from "../../../shared/utils/base-models/base-service";
import sequelize from "../../../config/sequelize";
import UnitBusiness from "./unit-business.model";
import unitBusinessRepository, {
  UnitBusinessRepository,
} from "./unit-business.repository";
import { UnitBusinessAttributes } from "./unit-business.types";
import UnitBusinessConfig from "./unit-business-config/unit-business-config.model";
import { resolveAllowedUnitBusinessIds } from "../../../shared/utils/entities/users/resolve-user-unit-business";
import redisService from "../../../shared/utils/base-models/base-redis";
import User from "../users/users/user.model";
import { UserAttributes } from "../users/users/user.types";
import Role from "../users/roles/role.model";
import expeditionBatchService from "../../warehouse/expedition/batch/batch.service";
import { comercialUnitBusinessWhere } from "./helpers/comercial-unit-business";
import roleService from "../users/roles/role.service";

// Não existe flag/coluna própria pra marcar a loja CD21 — identificação
// centralizada aqui (evita comparar "21"/"CD21" solto em vários lugares).
const CD21_UNIT_BUSINESS_NUMBER = "21";

export class UnitBusinessService extends BaseService<
  UnitBusiness,
  UnitBusinessRepository
> {
  constructor() {
    super(unitBusinessRepository);

    this.queryConfig = {
      filterableFields: ["id", "head_office", "type"],
      sortableFields: ["name", "number", "createdAt", "type"],
      searchFields: ["name", "cnpj"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  async findByIdWithConfig(id: string): Promise<UnitBusinessAttributes> {
    const result = await this.repository.findByIdWithConfig(id);

    return result;
  }

  async getHeadOffice(): Promise<UnitBusinessAttributes> {
    const headOffice = await this.repository.findOne({
      where: { head_office: true },
    });

    if (!headOffice) {
      throw Error("Matriz não cadastrada");
    }

    return headOffice;
  }

  async getCd21UnitBusiness(): Promise<UnitBusiness | null> {
    return this.repository.findOne({
      where: { number: CD21_UNIT_BUSINESS_NUMBER },
    });
  }

  async update(
    id: string,
    data: Partial<UnitBusinessAttributes> & {
      label_stock_id?: string | null;
      label_shipping_id?: string | null;
    },
    options?: { transaction?: Transaction },
  ): Promise<UnitBusiness | null> {
    const { label_stock_id, label_shipping_id, ...unitBusinessData } = data;

    const run = async (transaction: Transaction) => {
      const updated = await this.repository.update(id, unitBusinessData, {
        transaction,
      });

      if (label_stock_id !== undefined || label_shipping_id !== undefined) {
        const configPatch: Record<string, unknown> = {};
        if (label_stock_id !== undefined)
          configPatch.label_stock_id = label_stock_id;
        if (label_shipping_id !== undefined)
          configPatch.label_shipping_id = label_shipping_id;

        const existingConfig = await UnitBusinessConfig.findOne({
          where: { unit_business_id: id },
          transaction,
        });

        if (existingConfig) {
          await existingConfig.update(configPatch, { transaction });
        } else {
          await UnitBusinessConfig.create(
            { unit_business_id: id, ...configPatch },
            { transaction },
          );
        }
      }

      return updated;
    };

    if (options?.transaction) {
      return run(options.transaction);
    }

    return sequelize.transaction(run);
  }

  private async resolveUser(userId: string): Promise<UserAttributes | null> {
    let user: UserAttributes | null = await redisService.get(
      `user:${userId}`,
    );
    if (!user) {
      user = await User.findByPk(userId, {
        include: [{ model: Role, as: "role" }],
      });
    }

    return user;
  }

  /**
   * IDs de unit business que o usuário pode ver, ou undefined se ele tem
   * a permissão "visualize-all-unit-business" (sem restrição).
   */
  private async resolveEffectiveAllowedUnitBusinessIds(
    userId?: string,
    requestedIds?: string | string[],
  ): Promise<string[] | undefined> {
    if (!userId) return undefined;

    const user = await this.resolveUser(userId);

    const allowedIds = await resolveAllowedUnitBusinessIds(
      userId,
      requestedIds,
    );

    const canViewAll = user?.role?.permissions.find(
      (s) => s.entity === "visualize-all-unit-business",
    );

    return allowedIds && !canViewAll ? allowedIds : undefined;
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<UnitBusiness>> {
    const allowedIds = await this.resolveEffectiveAllowedUnitBusinessIds(
      params.userId,
      params.filters?.unit_business_id,
    );

    const { userId, ...safeParams } = params;

    const finalParams: QueryParams = allowedIds
      ? { ...safeParams, filters: { ...safeParams.filters, id: allowedIds } }
      : safeParams;

    return this.repository.findPaginated(
      finalParams,
      this.queryConfig,
      extraOptions,
    );
  }

  async getUnitBusinessPublic(
    params: QueryParams,
  ): Promise<PaginatedResult<UnitBusiness>> {
    return this.repository.findPaginated(
      params,
      this.queryConfig,
      { attributes: ["id", "name", "number"] },
      comercialUnitBusinessWhere(),
      [["number", "DESC"]],
    );
  }

  async getComercialUnitBusinessOnly(): Promise<UnitBusinessAttributes[]> {
    const result = await this.findAll({
      where: comercialUnitBusinessWhere(),
      order: [["number", "DESC"]],
    });

    if (!result)
      throw new Error("Nenhuma unit business válida para negócio cadastrada");

    return result;
  }

  /**
   * IDs de unit business que o usuário pode trocar/operar: admin vê tudo,
   * senão só as lojas atribuídas (ignora "visualize-all-unit-business",
   * que só afeta escopo de visualização de dados, não de troca de loja).
   */
  private async resolveSwitchableUnitBusinessIds(
    userId: string,
  ): Promise<string[] | undefined> {
    const user = await this.resolveUser(userId);
    if (!user) return undefined;

    const isAdmin = await roleService.isAdminRole(user.role_id);
    if (isAdmin) return undefined;

    return resolveAllowedUnitBusinessIds(userId);
  }

  async getComercialUnitBusinessOnlyForUser(
    userId: string,
  ): Promise<UnitBusinessAttributes[]> {
    const allowedIds = await this.resolveSwitchableUnitBusinessIds(userId);

    const result = await this.findAll({
      where: allowedIds
        ? { ...comercialUnitBusinessWhere(), id: allowedIds }
        : comercialUnitBusinessWhere(),
      order: [["number", "DESC"]],
      attributes: ["id", "name", "number"],
    });

    if (!result)
      throw new Error("Nenhuma unit business válida para negócio cadastrada");

    return result;
  }

  /**
   * Devolve o número do último lote OUTGOING pendente (não finalizado) da
   * unit business. Consulta expedition_batches diretamente (mesma fonte de
   * verdade que setBatchNumber usa) em vez de confiar cegamente no ponteiro
   * last_outgoing_batch_pending — se ele estiver desatualizado (lote criado
   * por outro fluxo, ou já finalizado), essa função corrige o ponteiro pra
   * refletir a realidade antes de retornar.
   */
  async getOrUpdateLastOutgoingBatchNumber(
    unitBusinessId: string,
  ): Promise<string | null> {
    const realBatch = await expeditionBatchService.findOne({
      where: {
        unit_business_id: unitBusinessId,
        type: "OUTGOING",
        status: { [Op.ne]: "FINISHED" },
      },
      order: [["createdAt", "DESC"]],
      attributes: ["id", "number"],
    });

    if (!realBatch) {
      // não há lote pendente real — garante que o ponteiro reflita isso
      await this.update(unitBusinessId, { last_outgoing_batch_pending: null });
      return null;
    }

    const unitBusiness = await this.findById(unitBusinessId);

    // ponteiro desatualizado/dessincronizado - corrige
    if (unitBusiness?.last_outgoing_batch_pending !== realBatch.id) {
      await this.update(unitBusinessId, {
        last_outgoing_batch_pending: realBatch.id,
      });
    }

    return realBatch.number ?? null;
  }

  async shutdownRedis() {
    await redisService.client.quit();
  }
}

export default new UnitBusinessService();
