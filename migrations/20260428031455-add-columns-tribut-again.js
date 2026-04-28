'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'ean_tribut', {
      type: Sequelize.STRING(20),
      allowNull: true,
      unique: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('products', 'ean_tribut');
  },
};