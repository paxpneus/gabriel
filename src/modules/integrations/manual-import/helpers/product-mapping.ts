import { Op } from "sequelize";
import integrationMappingService from "../../integration-mapping/integration-mapping.service";

// Produto existente = tem integration mapping na integração; uma consulta pra todos os ids.
export async function findProductLocalIds(
  integrationId: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const mappings = await integrationMappingService.findAll({
    where: {
      entity_type: "PRODUCT",
      integrations_id: integrationId,
      external_id: { [Op.in]: externalIds },
    },
    attributes: ["external_id", "internal_id"],
  });
  return new Map(mappings.map((m) => [m.external_id, m.internal_id]));
}

// Um produto pode ter vários external_id na mesma integração — usa o principal (é ele que alimenta o produto); o
// updatedAt muda a cada sync de qualquer código (erp_data), então só desempata.
export async function findProductExternalId(
  integrationId: string,
  productId: string,
): Promise<string | null> {
  const mapping = await integrationMappingService.findOne({
    where: {
      entity_type: "PRODUCT",
      integrations_id: integrationId,
      internal_id: productId,
    },
    attributes: ["external_id"],
    order: [["is_primary", "DESC"], ["updatedAt", "DESC"]],
  });
  return mapping?.external_id ?? null;
}
