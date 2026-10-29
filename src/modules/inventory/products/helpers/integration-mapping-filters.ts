import { Op, Sequelize, WhereOptions } from "sequelize";
import sequelize from "../../../../config/sequelize";

/** Literal booleano: o produto tem integration mapping (`PRODUCT`) na integração; sem integração → FALSE. */
export function productMappedToIntegrationLiteral(
  integrationId: string | null | undefined,
  productAlias: string = "Product",
) {
  if (!integrationId) return Sequelize.literal("FALSE");
  // internal_id é varchar (sem FK), por isso o cast do id do produto.
  return Sequelize.literal(`EXISTS (
    SELECT 1
    FROM integration_mappings im
    WHERE im.entity_type = 'PRODUCT'
      AND im.integrations_id = ${sequelize.escape(integrationId)}
      AND im.internal_id = "${productAlias}"."id"::text
  )`);
}

/** Produtos com integration mapping (`PRODUCT`) na integração informada; sem integração → nada bate. */
export function productMappedToIntegrationWhere(
  integrationId: string | null | undefined,
  productAlias: string = "Product",
): WhereOptions {
  return { [Op.and]: [productMappedToIntegrationLiteral(integrationId, productAlias)] };
}
