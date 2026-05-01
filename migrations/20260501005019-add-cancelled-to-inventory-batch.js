'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // transporters.cnpj: 14 → 18
      await queryInterface.changeColumn('inventory_batches', 'status', {
        type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED', 'CANCELLED'),
      defaultValue: 'OPEN',
      allowNull: false,
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
      await queryInterface.changeColumn('inventory_batches', 'status', {
        type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED'),
      defaultValue: 'OPEN',
      allowNull: false,
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};