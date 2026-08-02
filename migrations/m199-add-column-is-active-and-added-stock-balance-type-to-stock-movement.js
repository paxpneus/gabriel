'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_movements', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_stock_movements_movement_type"
      ADD VALUE IF NOT EXISTS 'MANUAL_ADJUSTMENT';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('stock_movements', 'is_active');

    // PostgreSQL não permite remover diretamente um valor de ENUM.
    // Para remover MANUAL_ADJUSTMENT seria necessário recriar o ENUM.
  },
};