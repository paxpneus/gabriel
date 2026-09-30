'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const existing = await queryInterface.describeTable('orders');
    if (existing.net_total_order) return;

    await queryInterface.addColumn('orders', 'net_total_order', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const existing = await queryInterface.describeTable('orders');
    if (!existing.net_total_order) return;

    await queryInterface.removeColumn('orders', 'net_total_order');
  },
};
