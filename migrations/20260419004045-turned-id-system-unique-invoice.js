'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addConstraint('invoices', {
      fields: ['id_system'],
      type: 'unique',
      name: 'invoices_id_system',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('invoices', 'invoices_id_system');
  }
};