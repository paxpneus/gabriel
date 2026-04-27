'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'received_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('invoices', 'expected_receiving', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.changeColumn('invoices', 'status', {
      type: Sequelize.ENUM(
        'OPEN',
        'PENDING',
        'FINISHED',
        'FREE_TO_SCHEDULE',
        'WAITING_SCHEDULE_SALES',
        'SCHEDULED',
        'LATE',
        'CANCELLED',
      ),
      defaultValue: 'PENDING',
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'received_at');
    await queryInterface.removeColumn('invoices', 'expected_receiving');

    await queryInterface.changeColumn('invoices', 'status', {
      type: Sequelize.ENUM(
        'OPEN',
        'PENDING',
        'FINISHED',
        'CANCELLED',
      ),
      defaultValue: 'PENDING',
      allowNull: false,
    });
  },
};