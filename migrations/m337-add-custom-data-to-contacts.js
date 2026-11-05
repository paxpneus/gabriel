'use strict';

// Gerentes já cadastrados: um período desde 2023 (pega todo o histórico de pedidos), sem fim, com a loja/grupo atuais.
const EXISTING_MANAGERS_START_DATE = '2023-01-01';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Valores customizados por tipo do contato; gerente (SELLER_MANAGER) guarda loja/grupo por período em manager_periods.
    await queryInterface.addColumn('contacts', 'custom_data', { type: Sequelize.JSONB, allowNull: true });

    // Gerente sem loja nem grupo fica sem período (não ganhava comissão de gerente de nenhuma loja).
    await queryInterface.sequelize.query(
      `UPDATE contacts
       SET custom_data = jsonb_build_object('manager_periods', jsonb_build_array(jsonb_build_object(
             'unit_business_id', unit_business_id,
             'unit_business_group_id', unit_business_group_id,
             'start_date', CAST(:startDate AS text),
             'end_date', NULL
           ))),
           updated_at = now()
       WHERE type = 'SELLER_MANAGER'
         AND (unit_business_id IS NOT NULL OR unit_business_group_id IS NOT NULL)`,
      { replacements: { startDate: EXISTING_MANAGERS_START_DATE } },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('contacts', 'custom_data');
  },
};
