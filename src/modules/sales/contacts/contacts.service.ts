import BaseService from "../../../shared/utils/base-models/base-service";
import unitBusinessService from "../../company/unit-business/unit-business.service";
import userService from "../../company/users/users/user.service";
import Contact from "./contacts.model";
import contactRepository, { ContactRepository } from "./contacts.repository";
import sequelize from "../../../config/sequelize";
import roleService from "../../company/users/roles/role.service";
import { Op, Transaction, UniqueConstraintError } from "sequelize";
import User from "../../company/users/users/user.model";
import { UserAttributes } from "../../company/users/users/user.types";
import integrationMappingService from "../../integrations/integration-mapping/integration-mapping.service";
import { SELLER_CONTACT_TYPES } from "./contacts.types";

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
    };
  }

  /**
   * Acha o vendedor pelo código na integração (mapping → contato legado sem mapping) ou cria um provisório.
   * `newlyMapped` = não tinha mapping (criado ou legado adotado agora): nome/loja ainda precisam vir da integração.
   */
  async findOrCreateIntegrationSeller(
    externalId: string,
    name: string | null,
    integrationId: string,
  ): Promise<{ id: string; newlyMapped: boolean }> {
    const mapped = (await integrationMappingService.findEntityByMapping(
      "CONTACT",
      integrationId,
      externalId,
    )) as Contact | null;

    if (mapped) {
      if (name && mapped.name !== name) {
        await this.repository.update(mapped.id, { name });
      }
      return { id: mapped.id, newlyMapped: false };
    }

    try {
      // Contato + mapping na mesma transação: se a criação perder a corrida, o rollback não deixa contato órfão.
      return await sequelize.transaction(async (t) => {
        const legacy = await this.repository.findOne({
          where: {
            id_system: externalId,
            // Gerente (SELLER_MANAGER) também é vendedor.
            type: { [Op.in]: SELLER_CONTACT_TYPES },
            integrations_id: integrationId,
          },
          attributes: ["id"],
          order: [["createdAt", "ASC"]],
          transaction: t,
        });

        let contactId = legacy?.id;
        if (!contactId) {
          const contact = await this.repository.create(
            {
              id_system: externalId,
              name: name ?? `Vendedor ${externalId}`,
              type: "SELLER",
              integrations_id: integrationId,
              unit_business_id: null,
            },
            { transaction: t },
          );
          contactId = contact.id;
        }

        const mapping =
          await integrationMappingService.createOrUpdateIntegrationMapping(
            {
              entity_type: "CONTACT",
              internal_id: contactId,
              external_id: externalId,
              integrations_id: integrationId,
            },
            t,
          );

        // Outro job mapeou o vendedor depois da busca acima: descarta o contato criado aqui e usa o dele.
        if (mapping.internal_id !== contactId) {
          if (!legacy) await this.repository.delete(contactId, { transaction: t });
          return { id: mapping.internal_id, newlyMapped: false };
        }

        return { id: contactId, newlyMapped: true };
      });
    } catch (error) {
      // Outro job ainda não commitado criou o mesmo mapping (unique estoura no insert): rollback e usa o contato dele.
      if (!(error instanceof UniqueConstraintError)) throw error;
      const winner = (await integrationMappingService.findEntityByMapping(
        "CONTACT",
        integrationId,
        externalId,
      )) as Contact | null;
      if (!winner) throw error;
      return { id: winner.id, newlyMapped: false };
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
    // `||` e não `??`: docker-compose repassa FRONTEND_URL vazio ("") quando não definido no host.
    const baseUrl = process.env.FRONTEND_URL || "https://hub.paxpneus.com.br";
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
  ): Promise<{ url: string; user: Omit<UserAttributes, "password"> }> {
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
          type: 'seller'
        },
        t
      );
    });
  }
}

export default new ContactService();