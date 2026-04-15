'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('products', 'ean', {
      type: Sequelize.STRING(20),
      allowNull: false,
      unique: true,
    });

  },

  async down(queryInterface, Sequelize) {
      await queryInterface.changeColumn('products', 'ean', {
      type: Sequelize.STRING(13),
      allowNull: false,
      unique: true,
    });
  },
};