'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Renomear status_id -> status_normalized
      await queryInterface.renameColumn(
        'daily_sales_status_facts',
        'status_id',
        'status_normalized',
        { transaction }
      );

      // Renomear status_name -> status_display_name
      await queryInterface.renameColumn(
        'daily_sales_status_facts',
        'status_name',
        'status_display_name',
        { transaction }
      );

      // Adicionar integration_id
      await queryInterface.addColumn(
        'daily_sales_status_facts',
        'integration_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'integrations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction }
      );

      // Índice para a FK
      await queryInterface.addIndex(
        'daily_sales_status_facts',
        ['integration_id'],
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeIndex(
        'daily_sales_status_facts',
        ['integration_id'],
        { transaction }
      );

      await queryInterface.removeColumn(
        'daily_sales_status_facts',
        'integration_id',
        { transaction }
      );

      await queryInterface.renameColumn(
        'daily_sales_status_facts',
        'status_display_name',
        'status_name',
        { transaction }
      );

      await queryInterface.renameColumn(
        'daily_sales_status_facts',
        'status_normalized',
        'status_id',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};