'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // transporters.cnpj: 14 → 18
      await queryInterface.changeColumn('transporters', 'cnpj', {
        type: Sequelize.STRING(18),
        allowNull: false,
        unique: true,
      }, { transaction });

      // unit_businesses.cnpj: 14 → 18
      await queryInterface.changeColumn('unit_businesses', 'cnpj', {
        type: Sequelize.STRING(18),
        allowNull: true,
        unique: true,
      }, { transaction });

      // users.cpf: 11 → 14
      await queryInterface.changeColumn('users', 'cpf', {
        type: Sequelize.STRING(14),
        allowNull: false,
        unique: true,
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.changeColumn('transporters', 'cnpj', {
        type: Sequelize.STRING(14),
        allowNull: false,
        unique: true,
      }, { transaction });

      await queryInterface.changeColumn('unit_businesses', 'cnpj', {
        type: Sequelize.STRING(14),
        allowNull: true,
        unique: true,
      }, { transaction });

      await queryInterface.changeColumn('users', 'cpf', {
        type: Sequelize.STRING(11),
        allowNull: false,
        unique: true,
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};