'use strict';

// Espelha src/modules/warehouse/fiscal/invoices/invoice/helpers/tracking-url.ts
const TRACKING_URL_PREFIX = 'https://paxpneus.acompanharentrega.com.br/?tpDoc=4&doc=002%2F';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    const [integration] = await sequelize.query(
      `SELECT id FROM integrations WHERE name = 'Bling' AND type = 'SYSTEM' LIMIT 1`,
      { type: 'SELECT' },
    );
    if (!integration) throw new Error('Integração Bling não encontrada');

    // Número sem zeros à esquerda; nota sem número (ou só zeros) fica sem link.
    await sequelize.query(
      `UPDATE invoices
       SET tracking_url = :prefix || LTRIM(TRIM(number_system), '0'), updated_at = NOW()
       WHERE integrations_id = :integrationId
         AND NULLIF(LTRIM(TRIM(number_system), '0'), '') IS NOT NULL`,
      { replacements: { prefix: TRACKING_URL_PREFIX, integrationId: integration.id } },
    );
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.query(
      `UPDATE invoices SET tracking_url = NULL
       WHERE integrations_id = (SELECT id FROM integrations WHERE name = 'Bling' AND type = 'SYSTEM' LIMIT 1)`,
    );
  },
};
