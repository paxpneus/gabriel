'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges 
      DROP CONSTRAINT carrier_label_ranges_transporter_id_key;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE carrier_label_ranges 
      ADD CONSTRAINT carrier_label_ranges_transporter_id_key 
      UNIQUE (transporter_id);
    `);
  }
};