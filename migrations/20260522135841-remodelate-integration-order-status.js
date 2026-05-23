'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Renomear tabela
      await queryInterface.renameTable(
        'external_order_status_mappings',
        'integration_order_status_mappings',
        { transaction }
      );

      // Remover source_system
      await queryInterface.removeColumn(
        'integration_order_status_mappings',
        'source_system',
        { transaction }
      );

      // integration_id NOT NULL
      await queryInterface.changeColumn(
        'integration_order_status_mappings',
        'integration_id',
        {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'integrations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        { transaction }
      );

      // UNIQUE (integration_id, external_status_id)
      await queryInterface.addConstraint(
        'integration_order_status_mappings',
        {
          fields: ['integration_id', 'external_status_id'],
          type: 'unique',
          name: 'uq_integration_order_status_mappings_integration_status',
          transaction,
        }
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
      await queryInterface.removeConstraint(
        'integration_order_status_mappings',
        'uq_integration_order_status_mappings_integration_status',
        { transaction }
      );

      await queryInterface.changeColumn(
        'integration_order_status_mappings',
        'integration_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
        },
        { transaction }
      );

      await queryInterface.addColumn(
        'integration_order_status_mappings',
        'source_system',
        { type: Sequelize.STRING(50), allowNull: true },
        { transaction }
      );

      await queryInterface.renameTable(
        'integration_order_status_mappings',
        'external_order_status_mappings',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};