'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('unit_businesses', 'certificate_path', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

     await queryInterface.addColumn('unit_businesses', 'certificate_password', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });


  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'emitted_at');
    await queryInterface.removeColumn('invoices', 'number_system');


  }
};