'use strict';

const { randomUUID } = require('crypto');

// Backfill de rim_id/measure_id a partir dos valores de texto já existentes em
// products.rim/products.measure (extraídos por regex do nome na ingestão).
// Não perde nenhum valor: toda string distinta já cadastrada vira uma linha
// em rims/tire_measures, e todo product é religado pelo valor exato.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const [rimRows] = await queryInterface.sequelize.query(
        `SELECT DISTINCT rim AS value FROM products WHERE rim IS NOT NULL AND rim <> ''`,
        { transaction },
      );

      if (rimRows.length > 0) {
        const now = new Date();
        const rimRecords = rimRows.map((row) => ({
          id: randomUUID(),
          value: row.value,
          created_at: now,
          updated_at: now,
        }));

        await queryInterface.bulkInsert('rims', rimRecords, { transaction });
      }

      await queryInterface.sequelize.query(
        `UPDATE products p
         SET rim_id = r.id
         FROM rims r
         WHERE p.rim IS NOT NULL AND p.rim = r.value`,
        { transaction },
      );

      const [measureRows] = await queryInterface.sequelize.query(
        `SELECT DISTINCT measure AS value FROM products WHERE measure IS NOT NULL AND measure <> ''`,
        { transaction },
      );

      if (measureRows.length > 0) {
        const now = new Date();
        const measureRecords = measureRows.map((row) => ({
          id: randomUUID(),
          value: row.value,
          created_at: now,
          updated_at: now,
        }));

        await queryInterface.bulkInsert('tire_measures', measureRecords, {
          transaction,
        });
      }

      await queryInterface.sequelize.query(
        `UPDATE products p
         SET measure_id = m.id
         FROM tire_measures m
         WHERE p.measure IS NOT NULL AND p.measure = m.value`,
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
        `UPDATE products SET rim_id = NULL, measure_id = NULL`,
        { transaction },
      );
      await queryInterface.bulkDelete('rims', {}, { transaction });
      await queryInterface.bulkDelete('tire_measures', {}, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
