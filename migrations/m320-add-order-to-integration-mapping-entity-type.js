'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE enum_integration_mappings_entity_type ADD VALUE IF NOT EXISTS 'ORDER';`
    );
  },

  // Postgres não remove valor de ENUM sem recriar o tipo.
  async down() {},
};
