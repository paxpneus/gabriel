'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'batch_generated', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false
    });

    await queryInterface.addColumn('invoices', 'printed_label', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false
    });

    await queryInterface.addColumn('invoices', 'danfe_path', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'batch_generated');
    
    await queryInterface.removeColumn('invoices', 'printed_label');

     await queryInterface.removeColumn('invoices', 'danfe_path');
  }
};