'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_temp_files_entity_type"
      ADD VALUE IF NOT EXISTS 'CTE';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
