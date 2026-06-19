import BaseService from "../../../shared/utils/base-models/base-service";
import unitBusinessService from "../../warehouse/unit-business/unit-business.service";
import userService from "../../warehouse/users/users/user.service";
import Contact from "./contacts.model";
import contactRepository, { ContactRepository } from "./contacts.repository";
import sequelize from "../../../config/sequelize";
import roleService from "../../warehouse/users/roles/role.service";
import { Transaction } from "sequelize";
import User from "../../warehouse/users/users/user.model";

export class ContactService extends BaseService<Contact, ContactRepository> {
  constructor() {
    super(contactRepository);
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private normalizeUnitNumber(number: number | string): string {
    return String(number).padStart(2, "0");
  }

  /**
   * Resolve o usuário a partir das credenciais:
   * - Se já existe um user com o email, faz login e retorna
   * - Se não existe, cria o user com os dados do seller e faz login
   */
  private async resolveUser(
    {
      sellerName,
      sellerCpf,
      unitBusinessId,
      roleId,
      email,
      password,
    }: {
      sellerName: string;
      sellerCpf: string;
      unitBusinessId: string;
      roleId: string;
      email: string;
      password: string;
    },
    t: Transaction
  ): Promise<{ token: string; user: User }> {
    const existingUser = await userService.findOne({
      where: { email },
      transaction: t,
    });

    if (existingUser) {
      return userService.login(email, password);
    }

    await userService.createUserWithValidation({
      name: sellerName,
      email,
      password,
      cpf: sellerCpf,
      unit_business_id: unitBusinessId,
      user_unit_business: [unitBusinessId],
      role_id: roleId,
    });

    return userService.login(email, password);
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
          sellerCpf: seller.id_system,
          unitBusinessId: unitBusiness.id,
          roleId: role.id,
          email,
          password,
        },
        t
      );
    });
  }
}

export default new ContactService();