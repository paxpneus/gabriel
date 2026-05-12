'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'description', {
      type: Sequelize.STRING(255),
      allowNull: true,
      unique: false,
    });

    await queryInterface.addColumn('expedition_batches', 'description', {
      type: Sequelize.STRING(255),
      allowNull: true,
      unique: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'description');  

    await queryInterface.removeColumn('expedition_batches', 'description');
  },
};