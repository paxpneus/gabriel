import BaseService from "../../../shared/utils/base-models/base-service";
import unitBusinessService from "../../company/unit-business/unit-business.service";
import userService from "../../company/users/users/user.service";
import Contact from "./contacts.model";
import contactRepository, { ContactRepository } from "./contacts.repository";
import sequelize from "../../../config/sequelize";
import roleService from "../../company/users/roles/role.service";
import { Transaction, UniqueConstraintError, UpdateOptions } from "sequelize";
import { UserAttributes } from "../../company/users/users/user.types";
import { CreateContactWithUserInput } from "./schemas/contact.schema";
import { ContactCreationAttributes, ContactCustomData } from "./contacts.types";
import {
  CONTACT_USER_TYPE_CONFIG,
  ContactUserTypeConfig,
  parseContactCustomData,
} from "./helpers/contact-user-types";

const SELLER_REPORT_PATH = "/reports/sales/seller";

export class ContactService extends BaseService<Contact, ContactRepository> {
  constructor() {
    super(contactRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ['created_at', 'name'],
        sortDir: 'DESC',
      },
      searchFields: ['name'],
      filterableFields: ['type', 'unit_business_id'],
    };
  }

  private async resolveUnitBusinessId(
    config: ContactUserTypeConfig,
    unitBusinessId: string | undefined,
    t: Transaction,
  ): Promise<string> {
    if (!config.fixedUnitBusinessNumber) {
      if (!unitBusinessId) throw new Error("Loja (unit_business_id) é obrigatória para este tipo de contato");
      return unitBusinessId;
    }

    const unitBusiness = await unitBusinessService.findOne({
      where: { number: config.fixedUnitBusinessNumber },
      attributes: ["id"],
      transaction: t,
    });
    if (!unitBusiness) throw new Error(`Loja número "${config.fixedUnitBusinessNumber}" não encontrada`);
    return unitBusiness.id;
  }

  /** Cria user + contact numa transação; role, user type e loja vêm da config do tipo. */
  async createWithUser(dto: CreateContactWithUserInput) {
    const config = CONTACT_USER_TYPE_CONFIG[dto.type];
    if (!config) throw new Error(`Tipo de contato "${dto.type}" não permite criar usuário`);

    const customData = parseContactCustomData(dto.type, dto.custom_data ?? {});

    try {
      return await sequelize.transaction(async (t) => {
        const role = await roleService.findOne({
          where: { name: config.roleName },
          attributes: ["id"],
          transaction: t,
        });
        if (!role) throw new Error(`Role "${config.roleName}" não encontrada`);

        const unitBusinessId = await this.resolveUnitBusinessId(config, dto.unit_business_id, t);

        const user = await userService.createUserWithValidation(
          {
            name: dto.name,
            cpf: dto.cpf,
            email: dto.email,
            password: dto.password,
            phone: dto.phone ?? null,
            unit_business_id: unitBusinessId,
            user_unit_business: [unitBusinessId],
            role_id: role.id,
            type: config.userType,
          },
          t,
        );

        const contact = await this.repository.create(
          {
            name: dto.name,
            type: dto.type,
            document: user.cpf,
            unit_business_id: unitBusinessId,
            user_id: user.id,
            custom_data: customData,
          },
          { transaction: t },
        );

        return {
          contact,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            cpf: user.cpf,
            phone: user.phone ?? null,
            unit_business_id: user.unit_business_id,
            type: config.userType,
          },
        };
      });
    } catch (err) {
      throw this.translateUniqueError(err);
    }
  }

  /** custom_data faz merge com o JSON atual (não substitui) e é validado pelo schema do tipo. */
  async update(
    id: string,
    data: Partial<ContactCreationAttributes>,
    options?: Partial<UpdateOptions>,
  ) {
    if (data.custom_data === undefined) return super.update(id, data, options);

    const current = await this.repository.findOne({
      where: { id },
      attributes: ["id", "type", "custom_data"],
    });
    if (!current) return null;

    const type = data.type ?? current.type;
    const previous: ContactCustomData = current.custom_data ?? {};
    const merged = parseContactCustomData(type, { ...previous, ...(data.custom_data ?? {}) });

    return super.update(id, { ...data, custom_data: merged }, options);
  }

  private translateUniqueError(err: unknown): unknown {
    if (!(err instanceof UniqueConstraintError)) return err;
    const constraint = (err.parent as any)?.constraint ?? "";
    if (constraint.includes("user_id")) return new Error("Este usuário já está vinculado a outro contato");
    return new Error("Dados duplicados, verifique os dados do contato");
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private normalizeUnitNumber(number: number | string): string {
    return String(number).padStart(2, "0");
  }

  /**
   * Monta a URL completa do front que já carrega o token de acesso,
   * em vez do back devolver o token "cru" pro chamador.
   */
  private buildSellerReportUrl(token: string): string {
    const baseUrl = process.env.FRONTEND_URL ?? "https://hub.paxpneus.com.br";
    return `${baseUrl}${SELLER_REPORT_PATH}/${token}`;
  }

  /**
   * Resolve o usuário a partir das credenciais:
   * - Se já existe um user com o email, faz login
   * - Se não existe, cria o user com os dados do seller e faz login
   * Em ambos os casos, devolve a URL completa do front (com o token embutido).
   */
  private async resolveUser(
    {
      sellerName,
      sellerCpf,
      unitBusinessId,
      roleId,
      email,
      password,
      type
    }: {
      sellerName: string;
      sellerCpf: string;
      unitBusinessId: string;
      roleId: string;
      email: string;
      password: string;
      type: string;
    },
    t: Transaction
  ): Promise<{ url: string; user: UserAttributes }> {
    const existingUser = await userService.findOne({
      where: { email },
      transaction: t,
    });

    if (!existingUser) {
      await userService.createUserWithValidation({
        name: sellerName,
        email,
        password,
        cpf: sellerCpf,
        unit_business_id: unitBusinessId,
        user_unit_business: [unitBusinessId],
        role_id: roleId,
        type
      });
    }

    const { token, user } = await userService.login(email, password);

    return { url: this.buildSellerReportUrl(token), user };
  }

  async createUserFromSellerName(
    name: string,
    unitBusinessNumber: number | string,
    email: string,
    password: string
  ) {
    const normalizedName = this.normalizeName(name);
    const normalizedNumber = this.normalizeUnitNumber(unitBusinessNumber);

    return await sequelize.transaction(async (t) => {
      const role = await roleService.findOne({
        where: { name: "Vendedor" },
        transaction: t,
      });

      if (!role) {
        throw new Error('Role "Vendedor" não encontrada');
      }

      const seller = await this.repository.findOne({
        where: sequelize.where(
          sequelize.fn("LOWER", sequelize.fn("TRIM", sequelize.col("name"))),
          normalizedName
        ) as any,
        transaction: t,
      });

      if (!seller) {
        throw new Error(`Vendedor "${name}" não encontrado`);
      }

      // Fluxo do vendedor do Bling: id_system é o CPF usado no usuário.
      if (!seller.id_system) {
        throw new Error(`Vendedor "${name}" sem id_system cadastrado`);
      }
      const sellerCpf = seller.id_system;

      const unitBusiness = await unitBusinessService.findOne({
        where: { number: normalizedNumber },
        transaction: t,
      });

      if (!unitBusiness) {
        throw new Error(`Loja número "${normalizedNumber}" não encontrada`);
      }

      if (!seller.unit_business_id || seller.unit_business_id !== unitBusiness.id) {
        await this.repository.update(
          seller.id,
          { unit_business_id: unitBusiness.id },
          { transaction: t }
        );
      }

      return this.resolveUser(
        {
          sellerName: seller.name,
          sellerCpf,
          unitBusinessId: unitBusiness.id,
          roleId: role.id,
          email,
          password,
          type: 'seller'
        },
        t
      );
    });
  }
}

export default new ContactService();