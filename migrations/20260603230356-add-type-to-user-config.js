'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_config', 'type', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'standard',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('user_config', 'type');
  },
};