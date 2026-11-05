import { Op, Transaction } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import Contact from "../../contacts.model";
import { SELLER_CONTACT_TYPES } from "../../contacts.types";

// Queries de vendedor/gerente (contatos SELLER/SELLER_MANAGER) sobre a mesma tabela contacts.
export class SellerRepository extends BaseRepository<Contact> {
  constructor() {
    super(Contact);
  }

  /** Vendedor legado (sem mapping) pelo código na integração; o mais antigo se houver duplicado. Gerente também é vendedor. */
  findLegacyIntegrationSeller(externalId: string, integrationId: string, transaction: Transaction) {
    return this.model.findOne({
      where: {
        id_system: externalId,
        type: { [Op.in]: SELLER_CONTACT_TYPES },
        integrations_id: integrationId,
      },
      attributes: ["id"],
      order: [["createdAt", "ASC"]],
      transaction,
    });
  }

  /** Contato pelo nome já normalizado (minúsculo, sem espaço sobrando), comparando com LOWER(TRIM(name)). */
  findByNormalizedName(normalizedName: string, transaction: Transaction) {
    return this.model.findOne({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.fn("TRIM", sequelize.col("name"))),
        normalizedName,
      ) as any,
      transaction,
    });
  }
}

export default new SellerRepository();
