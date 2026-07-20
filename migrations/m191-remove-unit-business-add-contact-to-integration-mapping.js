'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Remove a coluna unit_business_id
      await queryInterface.removeColumn('integration_mappings', 'unit_business_id', { transaction });

      // 2. Adiciona o valor 'CONTACT' ao ENUM (PostgreSQL cria implicitamente o nome como enum_tableName_columnName)
      await queryInterface.sequelize.query(`
        ALTER TYPE enum_integration_mappings_entity_type ADD VALUE IF NOT EXISTS 'CONTACT';
      `, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Desfaz a remoção da coluna (restaura como era antes)
      await queryInterface.addColumn(
        'integration_mappings', 
        'unit_business_id', 
        { 
          type: Sequelize.UUID, // ajuste para STRING(100) ou outro tipo se não for UUID no seu banco original
          allowNull: true 
        }, 
        { transaction }
      );

      // Note: O Postgres não permite remover valores de um ENUM diretamente com DROP VALUE.
      // Caso seja estritamente necessário fazer o rollback do ENUM, seria preciso recriar o tipo,
      // o que geralmente não é recomendado em produção por segurança dos dados existentes.

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};