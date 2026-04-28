'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'transporter_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

     await queryInterface.addColumn('invoices', 'transporter_document', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'transporter_name');
    await queryInterface.removeColumn('invoices', 'transporter_document');
  },
};