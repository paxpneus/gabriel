'use strict';

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeIndex('orders',    'idx_orders_integration_external_id',    { transaction });
      await queryInterface.removeIndex('orders',    'idx_orders_external_invoice_id',         { transaction });
      await queryInterface.removeIndex('products',  'idx_products_integration_external_id',   { transaction });
      await queryInterface.removeIndex('invoices',  'idx_invoices_integration_external_id',   { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addIndex('invoices', ['integrations_id', 'external_id'], { name: 'idx_invoices_integration_external_id', transaction });
      await queryInterface.addIndex('products',  ['integrations_id', 'external_id'], { name: 'idx_products_integration_external_id', transaction });
      await queryInterface.addIndex('orders',    ['external_invoice_id'],             { name: 'idx_orders_external_invoice_id',      transaction });
      await queryInterface.addIndex('orders',    ['integrations_id', 'external_id'], { name: 'idx_orders_integration_external_id',  transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};