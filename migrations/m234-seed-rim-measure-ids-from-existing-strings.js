'use strict';

const { randomUUID } = require('crypto');
// products.measure guarda o token bruto extraído do nome (ex: "175/25R15"),
// que inclui o aro junto com a medida. Para tire_measures queremos só a
// parte largura/perfil (ex: "175/25"), então removemos o sufixo de aro
// (R15, ZR17, X18, etc.) antes de gravar. O mesmo padrão é usado tanto para
// montar os valores distintos quanto para religar os products via SQL, para
// que os dois lados fiquem sempre consistentes.
const MEASURE_CORE_SQL_PATTERN = '^(\\d+([.,]\\d+)?/\\d+).*$';
const MEASURE_CORE_JS_REGEX = /^(\d+(?:[.,]\d+)?\/\d+)/;

function stripRimFromMeasure(value) {
  const match = value.match(MEASURE_CORE_JS_REGEX);
  return match ? match[1] : value;
}

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
        const measureIds = new Map();

        for (const row of measureRows) {
          const value = stripRimFromMeasure(row.value);

          if (!measureIds.has(value)) {
            measureIds.set(value, randomUUID());
          }
        }

        const measureRecords = Array.from(
          measureIds,
          ([value, id]) => ({
            id,
            value,
            created_at: now,
            updated_at: now,
          }),
        );

        await queryInterface.bulkInsert('tire_measures', measureRecords, {
          transaction,
        });
      }

      await queryInterface.sequelize.query(
        `UPDATE products p
         SET measure_id = m.id
         FROM tire_measures m
         WHERE p.measure IS NOT NULL
           AND regexp_replace(p.measure, '${MEASURE_CORE_SQL_PATTERN}', '\\1') = m.value`,
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
