'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('invoices', 'received_at', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    await queryInterface.changeColumn('invoices', 'expected_receiving', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('invoices', 'received_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.changeColumn('invoices', 'expected_receiving', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },
};