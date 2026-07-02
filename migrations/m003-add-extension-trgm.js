'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        CREATE EXTENSION IF NOT EXISTS pg_trgm;

        CREATE INDEX IF NOT EXISTS brands_name_trgm_idx
          ON brands
          USING gin (name gin_trgm_ops);
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS brands_name_trgm_idx;
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};