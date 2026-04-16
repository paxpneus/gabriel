'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.changeColumn('product_supplier_maps', 'supplier_cnpj', {
      type: Sequelize.STRING(30),
      allowNull: true,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.changeColumn('product_supplier_maps', 'supplier_cnpj', {
      type: Sequelize.STRING(20),
      allowNull: false,
    });
  }
};
