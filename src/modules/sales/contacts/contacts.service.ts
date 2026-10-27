import BaseService from "../../../shared/utils/base-models/base-service";
import unitBusinessService from "../../company/unit-business/unit-business.service";
import userService from "../../company/users/users/user.service";
import Contact from "./contacts.model";
import contactRepository, { ContactRepository } from "./contacts.repository";
import sequelize from "../../../config/sequelize";
import roleService from "../../company/users/roles/role.service";
import { Transaction, UniqueConstraintError, UpdateOptions } from "sequelize";
import { UserAttributes } from "../../company/users/users/user.types";
import { UserType } from "../../company/users/user_config/user_config.types";
import {
  AFFILIATED_USER_TYPE,
  SELLER_USER_TYPE,
} from "../../../shared/constants/user-types";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../company/unit-business/helpers/cd21-unit-business-number";
import {
  AFFILIATED_CONTACT_TYPE,
  ContactType,
  SELLER_CONTACT_TYPE,
} from "./contacts.types";
import { CreateContactWithUserInput } from "./schemas/contact.schema";

const SELLER_REPORT_PATH = "/reports/sales/seller";

// Contact types allowed on /with-user: user type + role name, and a fixed store when the type has one.
const CONTACT_USER_TYPE_CONFIG: Partial<
  Record<ContactType, { userType: UserType; roleName: string; fixedUnitBusinessNumber?: string }>
> = {
  [AFFILIATED_CONTACT_TYPE]: {
    userType: AFFILIATED_USER_TYPE,
    roleName: "Afiliado",
    fixedUnitBusinessNumber: CD21_UNIT_BUSINESS_NUMBER,
  },
  [SELLER_CONTACT_TYPE]: { userType: SELLER_USER_TYPE, roleName: "Vendedor" },
};

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
      // filters[type]=AFFILIATED lets the front list affiliates.
      filterableFields: ['type', 'unit_business_id'],
    };
  }

  // Merges custom_data with the stored value instead of replacing the whole JSONB.
  async update(
    id: string,
    data: Partial<Contact["_creationAttributes"]>,
    options?: Partial<UpdateOptions>,
  ) {
    if (data.custom_data) {
      const current = await this.repository.findById(id, {
        attributes: ["id", "custom_data"],
        transaction: options?.transaction,
      });
      if (current) {
        data = { ...data, custom_data: { ...(current.custom_data ?? {}), ...data.custom_data } };
      }
    }

    return super.update(id, data, options);
  }

  // Creates User + Contact atomically for types in CONTACT_USER_TYPE_CONFIG (contact has no id_system).
  async createWithUser(dto: CreateContactWithUserInput) {
    const config = CONTACT_USER_TYPE_CONFIG[dto.type];
    if (!config) {
      throw new Error(`Tipo de contato "${dto.type}" não permite criar usuário`);
    }

    try {
      return await sequelize.transaction(async (t) => {
        const role = await roleService.findOne({
          where: { name: config.roleName },
          attributes: ["id"],
          transaction: t,
        });
        if (!role) throw new Error(`Role "${config.roleName}" não encontrada`);

        let unitBusinessId = dto.unit_business_id;
        if (config.fixedUnitBusinessNumber) {
          const unitBusiness = await unitBusinessService.findOne({
            where: { number: config.fixedUnitBusinessNumber },
            attributes: ["id"],
            transaction: t,
          });
          if (!unitBusiness) {
            throw new Error(`Loja número "${config.fixedUnitBusinessNumber}" não encontrada`);
          }
          unitBusinessId = unitBusiness.id;
        }
        if (!unitBusinessId) {
          throw new Error("Loja (unit_business_id) é obrigatória para este tipo de contato");
        }

        const user = await userService.createUserWithValidation(
          {
            name: dto.name,
            cpf: dto.cpf,
            email: dto.email,
            password: dto.password,
            phone: dto.phone,
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
            custom_data: dto.custom_data ?? {},
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
      if (err instanceof UniqueConstraintError) {
        const field = err.errors?.[0]?.path;
        if (field === "user_id") throw new Error("Este usuário já está vinculado a outro contato");
        if (field === "document") throw new Error("Já existe um contato com este CPF");
      }
      throw err;
    }
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

      // id_system is optional since contacts can be created via /with-user; it is the seller's CPF here.
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