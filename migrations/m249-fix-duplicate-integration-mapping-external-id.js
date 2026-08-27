"use strict";

// O índice único antigo (unique_integration_mappings_idx) inclui internal_id
// na chave, o que permite duas linhas com o mesmo (entity_type,
// integrations_id, external_id) apontando pra produtos internos diferentes.
// Isso causava resolução não-determinística do produto errado via
// findEntityByMapping (sem ORDER BY, o Postgres sempre devolvia a linha mais
// antiga), fazendo o upsert do Tecinco tentar gravar um id_system que já
// pertencia a outro produto — ex: external_id=26440 tinha uma linha órfã
// apontando pra um detergente e outra apontando pro pneu correto.
//
// Essa migration: (1) remove as linhas duplicadas, mantendo a que aponta
// pro produto cujo id_system bate com o external_id (ou, na ausência disso,
// a mais recente por updated_at); (2) troca o índice único pra
// (entity_type, integrations_id, external_id), sem internal_id, pra impedir
// que essa duplicidade volte a acontecer.

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        WITH ranked AS (
          SELECT
            im.id,
            ROW_NUMBER() OVER (
              PARTITION BY im.entity_type, im.integrations_id, im.external_id
              ORDER BY
                CASE
                  WHEN im.entity_type = 'PRODUCT' AND EXISTS (
                    SELECT 1 FROM products p
                    WHERE p.id::text = im.internal_id
                      AND p.id_system = im.external_id
                  ) THEN 0
                  ELSE 1
                END,
                im.updated_at DESC
            ) AS rn
          FROM integration_mappings im
        )
        DELETE FROM integration_mappings
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
        `,
        { transaction },
      );

      await queryInterface.removeIndex(
        "integration_mappings",
        "unique_integration_mappings_idx",
        { transaction },
      );

      await queryInterface.addIndex(
        "integration_mappings",
        ["entity_type", "integrations_id", "external_id"],
        {
          unique: true,
          name: "unique_integration_mappings_entity_integration_external_idx",
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // As linhas duplicadas removidas no up() não são recuperáveis aqui —
      // o down() só reverte a estrutura do índice.
      await queryInterface.removeIndex(
        "integration_mappings",
        "unique_integration_mappings_entity_integration_external_idx",
        { transaction },
      );

      await queryInterface.addIndex(
        "integration_mappings",
        ["external_id", "internal_id", "entity_type", "integrations_id"],
        {
          unique: true,
          name: "unique_integration_mappings_idx",
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
