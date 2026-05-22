'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'daily_sales_facts',
        'integration_id',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
      );

      await queryInterface.removeConstraint(
        'daily_sales_facts',
        'daily_sales_facts_date_unit_unique', 
        { transaction },
      );

      await queryInterface.addConstraint('daily_sales_facts', {
        fields: ['fact_date', 'unit_business_id', 'integration_id'],
        type: 'unique',
        name: 'daily_sales_facts_fact_date_unit_business_id_integration_id_key',
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
        'daily_sales_facts',
        'daily_sales_facts_fact_date_unit_business_id_integration_id_key',
        { transaction },
      );

      await queryInterface.addConstraint('daily_sales_facts', {
        fields: ['fact_date', 'unit_business_id'],
        type: 'unique',
        name: 'daily_sales_facts_date_unit_unique',
        transaction,
      });

      await queryInterface.removeColumn('daily_sales_facts', 'integration_id', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};