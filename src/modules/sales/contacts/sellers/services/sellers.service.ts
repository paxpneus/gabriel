import BaseService from "../../../../../shared/utils/base-models/base-service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import userService from "../../../../company/users/users/user.service";
import Contact from "../../contacts.model";
import sellerRepository, { SellerRepository } from "../repositories/sellers.repository";
import sequelize from "../../../../../config/sequelize";
import roleService from "../../../../company/users/roles/role.service";
import { Transaction, UniqueConstraintError } from "sequelize";
import { UserAttributes } from "../../../../company/users/users/user.types";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";
import { SELLER_MANAGER_CONTACT_TYPE } from "../../contacts.types";
import { ManagerPeriod } from "../types/sellers.types";
import { withManagerPeriodNames } from "../helpers/manager-period-names";

const SELLER_REPORT_PATH = "/reports/sales/seller";

// Regra de vendedor/gerente (contatos SELLER/SELLER_MANAGER): vendedor da integração, usuário do vendedor, vigência do gerente.
export class SellerService extends BaseService<Contact, SellerRepository> {
  constructor() {
    super(sellerRepository);
  }

  /** Detalhe do contato (GET /api/contacts/:id) com o nome da loja/grupo em cada período do gerente; null = não existe. */
  async findDetail(id: string) {
    const contact = await this.repository.findById(id);
    if (!contact) return null;
    return withManagerPeriodNames(contact);
  }

  /**
   * Substitui os períodos do gerente (`custom_data.manager_periods`, mantendo as outras chaves) e volta com nome da loja/grupo; null = não existe.
   * Sem sobreposição: o relatório casa um período por data, então loja/grupo de cada data é um só (sem comissão em dobro).
   */
  async updateManagerPeriods(id: string, periods: ManagerPeriod[]) {
    const contact = await this.repository.findById(id, { attributes: ["id", "type", "custom_data"] });
    if (!contact) return null;
    if (contact.type !== SELLER_MANAGER_CONTACT_TYPE) {
      throw new Error("O contato não é gerente: marque como gerente antes de informar os períodos.");
    }

    // Datas YYYY-MM-DD comparam certo como texto; ordenado por início, sobrepõe se o anterior não termina antes do próximo começar.
    const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
    sorted.forEach((period, index) => {
      if (!period.unit_business_id && !period.unit_business_group_id) {
        throw new Error("Cada período do gerente precisa de uma loja ou de um grupo de lojas.");
      }
      if (period.end_date !== null && period.end_date < period.start_date) {
        throw new Error("A data de fim de um período do gerente não pode ser anterior à data de início.");
      }
      const previous = sorted[index - 1];
      if (previous && (previous.end_date === null || previous.end_date >= period.start_date)) {
        throw new Error(
          `Os períodos do gerente não podem se sobrepor: o que começa em ${previous.start_date} precisa terminar antes de ${period.start_date}.`,
        );
      }
    });

    const updated = await this.repository.update(id, {
      custom_data: { ...contact.custom_data, manager_periods: sorted },
    });
    if (!updated) return null;
    return withManagerPeriodNames(updated);
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
        const legacy = await this.repository.findLegacyIntegrationSeller(externalId, integrationId, t);

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

      const seller = await this.repository.findByNormalizedName(normalizedName, t);

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

export default new SellerService();