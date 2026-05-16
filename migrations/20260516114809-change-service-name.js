'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges
      RENAME COLUMN service_name TO destination;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges
      RENAME COLUMN destination TO service_name;
    `);
  }
};