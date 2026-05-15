'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges
      ALTER COLUMN route_acronym DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges
      ALTER COLUMN route_acronym SET NOT NULL;
    `);
  },
};
