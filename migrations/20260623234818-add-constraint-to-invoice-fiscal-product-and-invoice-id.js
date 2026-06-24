'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'product_id'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_id_product_id_unique',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeConstraint(
        'invoice_fiscal_items',
        'invoice_fiscal_items_invoice_id_product_id_unique',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};