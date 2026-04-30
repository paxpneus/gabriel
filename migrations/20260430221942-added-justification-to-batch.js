'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'justification', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('inventory_batches', 'justification', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expedition_batches', 'justification');
    await queryInterface.removeColumn('inventory_batches', 'justification');
    
  },
};