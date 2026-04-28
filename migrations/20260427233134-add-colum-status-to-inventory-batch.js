'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('inventory_batches', 'status', {
      type: Sequelize.ENUM('OPEN', 'PENDING', 'FINISHED'),
      defaultValue: 'OPEN',
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('inventory_batches', 'status');
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_inventory_batches_status";`);
  },
};