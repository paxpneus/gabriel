'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoice_items
        DROP COLUMN IF EXISTS status;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoice_items', 'status', {
      type: Sequelize.ENUM('PENDING', 'FINISHED'),
      allowNull: false,
      defaultValue: 'PENDING',
    });
    
  },
};