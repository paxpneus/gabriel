'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('config_tokens', 'api_key', {
      type: Sequelize.STRING(512),
      allowNull: true,
    });

    await queryInterface.addColumn('config_tokens', 'username', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    await queryInterface.addColumn('config_tokens', 'password', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('config_tokens', 'api_key');
    await queryInterface.removeColumn('config_tokens', 'username');
    await queryInterface.removeColumn('config_tokens', 'password');
  },
};