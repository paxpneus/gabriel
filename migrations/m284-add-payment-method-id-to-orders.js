'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'payment_method_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'payment_methods',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'payment_method_id');
  },
};
