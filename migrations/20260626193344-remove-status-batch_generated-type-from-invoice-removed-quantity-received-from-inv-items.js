'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoices
        DROP COLUMN IF EXISTS batch_generated,
        DROP COLUMN IF EXISTS type,
        DROP COLUMN IF EXISTS status;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'type', {
      type: Sequelize.ENUM('INCOMING', 'OUTGOING'),
      allowNull: false,
      defaultValue: 'INCOMING',
    });

    await queryInterface.addColumn('invoices', 'status', {
      type: Sequelize.ENUM(
        'PENDING',
        'OPEN',
        'WAITING_SCHEDULE_SALES',
        'FREE_TO_SCHEDULE',
        'SCHEDULED',
        'LATE',
        'FINISHED',
        'CANCELLED',
        'PENDING_CANCELLED_SYSTEM'
      ),
      allowNull: false,
      defaultValue: 'PENDING',
    });

    await queryInterface.addColumn('invoices', 'batch_generated', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    });
  },
};