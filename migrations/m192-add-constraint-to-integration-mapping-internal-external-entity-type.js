'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Cria a constraint de unicidade composta pelas 4 colunas
      await queryInterface.addIndex(
        'integration_mappings',
        ['external_id', 'internal_id', 'entity_type', 'integrations_id'],
        {
          unique: true,
          name: 'unique_integration_mappings_idx', // Nome da constraint/índice
          transaction
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
      // Remove a constraint de unicidade pelo nome
      await queryInterface.removeIndex(
        'integration_mappings',
        'unique_integration_mappings_idx',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};