'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('unit_businesses', 'cnpj', {
      type: Sequelize.STRING(14),
      allowNull: true,
      unique: true,
    });

    await queryInterface.changeColumn('unit_businesses', 'number', {
      type: Sequelize.STRING(50),
      allowNull: true,
      unique: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('unit_businesses', 'cnpj', {
      type: Sequelize.STRING(14),
      allowNull: false,
      unique: true,
    });

    await queryInterface.changeColumn('unit_businesses', 'number', {
      type: Sequelize.STRING(50),
      allowNull: false,
      unique: true,
    });
  },
};