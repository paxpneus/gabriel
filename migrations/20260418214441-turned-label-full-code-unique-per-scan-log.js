'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addConstraint('expedition_scan_logs', {
      fields: ['label_full_code'],
      type: 'unique',
      name: 'expedition_scan_logs_label_full_code',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('expedition_scan_logs', 'expedition_scan_logs_label_full_code');
  }
};