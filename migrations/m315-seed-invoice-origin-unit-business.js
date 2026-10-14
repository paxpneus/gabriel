'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    const [integration] = await sequelize.query(
      `SELECT id FROM integrations WHERE name = 'Bling' AND type = 'SYSTEM' LIMIT 1`,
      { type: 'SELECT' },
    );
    if (!integration) throw new Error('Integração Bling não encontrada');

    // source_payload das notas Bling guarda o payload da nota; loja.id casa com unit_businesses.id_system.
    await sequelize.query(
      `UPDATE invoices i
       SET origin_unit_business_id = ub.id, updated_at = NOW()
       FROM unit_businesses ub
       WHERE i.integrations_id = :integrationId
         AND i.source_payload -> 'loja' ->> 'id' IS NOT NULL
         AND ub.id_system = i.source_payload -> 'loja' ->> 'id'`,
      { replacements: { integrationId: integration.id } },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE invoices SET origin_unit_business_id = NULL`,
    );
  },
};
