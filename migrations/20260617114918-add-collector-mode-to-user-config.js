'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_config', 'auto_advance_collector', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('user_config', 'auto_advance_collector');
  },
};