'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'bonded_invoice', {
      type: Sequelize.STRING(255),
      allowNull: true,
      unique: false,
    });

   
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'bonded_invoice');  

    
  },
};