'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('products', 'ean', {
      type: Sequelize.STRING(20),
      allowNull: true,
      unique: false,
    });

     await queryInterface.changeColumn('products', 'sku', {
      type: Sequelize.STRING(20),
      allowNull: true,
      unique: false,
    });
  },

  async down(queryInterface, Sequelize) {
      await queryInterface.changeColumn('products', 'ean', {
      type: Sequelize.STRING(13),
      allowNull: false,
      unique: true,
    });

      await queryInterface.changeColumn('products', 'sku', {
      type: Sequelize.STRING(13),
      allowNull: false,
      unique: true,
    });
  },
};