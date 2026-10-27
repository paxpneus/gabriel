import { Op, Sequelize, WhereOptions } from "sequelize";
import sequelize from "../../../../config/sequelize";

/** Produtos com integration mapping (`PRODUCT`) na integração informada; sem integração → nada bate. */
export function productMappedToIntegrationWhere(
  integrationId: string | null | undefined,
  productAlias: string = "Product",
): WhereOptions {
  if (!integrationId) return { [Op.and]: [Sequelize.literal("FALSE")] };
  const t = sequelize.getQueryInterface().quoteIdentifier(productAlias);
  return {
    [Op.and]: [
      // internal_id é varchar (sem FK), por isso o cast do id do produto.
      Sequelize.literal(`EXISTS (
        SELECT 1
        FROM integration_mappings im
        WHERE im.entity_type = 'PRODUCT'
          AND im.integrations_id = ${sequelize.escape(integrationId)}
          AND im.internal_id = ${t}."id"::text
      )`),
    ],
  };
}
