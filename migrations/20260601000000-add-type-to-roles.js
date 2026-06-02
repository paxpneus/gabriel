'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('roles', 'type', {
      type: Sequelize.ENUM('USER', 'APPS'),
      allowNull: false,
      defaultValue: 'USER',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('roles', 'type');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_roles_type";');
  },
};
