'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE expedition_batches
      ALTER COLUMN number TYPE VARCHAR(255);
    `);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE expedition_batches
      ALTER COLUMN number TYPE VARCHAR(50);
    `);
  }
};