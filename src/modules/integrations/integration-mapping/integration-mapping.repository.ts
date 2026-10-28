import { Op, Sequelize } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import IntegrationMapping from './integration-mapping.model';

export class IntegrationMappingRepository extends BaseRepository<IntegrationMapping> {
  constructor() {
    super(IntegrationMapping);
  }

  // Mappings PRODUCT de produtos com 2+ códigos na integração (relatório "Duplicados no ERP"), mais antigo primeiro.
  // GROUP BY no banco pra não trazer todo mapping; do erp_data lê só nome/EAN/SKU (sem o estoque por filial).
  findProductMappingsWithMultipleCodes(integrationsId: string): Promise<IntegrationMapping[]> {
    return this.findAll({
      where: {
        entity_type: 'PRODUCT',
        integrations_id: integrationsId,
        internal_id: {
          [Op.in]: Sequelize.literal(`(
            SELECT im.internal_id FROM integration_mappings im
            WHERE im.entity_type = 'PRODUCT' AND im.integrations_id = :integrationsId
            GROUP BY im.internal_id HAVING COUNT(*) > 1
          )`),
        },
      },
      attributes: [
        'internal_id',
        'external_id',
        'is_primary',
        [Sequelize.literal('erp_data IS NOT NULL'), 'synced'],
        [Sequelize.literal(`erp_data->>'name'`), 'erp_name'],
        [Sequelize.literal(`erp_data->>'ean'`), 'erp_ean'],
        [Sequelize.literal(`erp_data->>'sku'`), 'erp_sku'],
      ],
      order: [['createdAt', 'ASC']],
      replacements: { integrationsId },
      raw: true,
    });
  }
}

export default new IntegrationMappingRepository();
