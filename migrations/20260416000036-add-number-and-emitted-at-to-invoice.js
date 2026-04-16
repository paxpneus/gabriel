'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'emitted_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: Sequelize.NOW,
    });

    await queryInterface.addColumn('invoices', 'number_system', {
      type: Sequelize.STRING(100),
      allowNull: true,
    
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'emitted_at');
    await queryInterface.removeColumn('invoices', 'number_system');


  }
};