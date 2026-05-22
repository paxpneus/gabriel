'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Remove a constraint de chave primária antiga
      await queryInterface.removeConstraint(
        'integration_order_status_mappings',
        'external_order_status_mappings_pkey',
        { transaction }
      );

      // Adiciona a nova constraint de chave primária com o nome atualizado
      await queryInterface.addConstraint(
        'integration_order_status_mappings',
        {
          fields: ['id'],
          type: 'primary key',
          name: 'integration_order_status_mappings_pkey',
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
      // Remove a nova constraint de chave primária
      await queryInterface.removeConstraint(
        'integration_order_status_mappings',
        'integration_order_status_mappings_pkey',
        { transaction }
      );

      // Reverte para o nome da constraint antiga
      await queryInterface.addConstraint(
        'integration_order_status_mappings',
        {
          fields: ['id'],
          type: 'primary key',
          name: 'external_order_status_mappings_pkey',
          transaction,
        }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};