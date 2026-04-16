'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addConstraint('unit_businesses', {
      fields: ['id_system'],
      type: 'unique',
      name: 'unit_businesses_id_system_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint(
      'unit_businesses',
      'unit_businesses_id_system_key',
    );
  },
};