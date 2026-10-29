'use strict';

// is_primary: qual mapping da mesma entidade na mesma integração é o "dono" dos dados no sync
// (o não principal só resolve a entidade). No máximo um principal por (entity_type, internal_id, integrations_id).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('integration_mappings', 'is_primary', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Backfill: o mapping mais antigo de cada entidade por integração vira principal
    // (entidade com 1 mapping só → ele mesmo).
    await queryInterface.sequelize.query(`
      UPDATE integration_mappings im
      SET is_primary = true
      FROM (
        SELECT DISTINCT ON (entity_type, internal_id, integrations_id) id
        FROM integration_mappings
        ORDER BY entity_type, internal_id, integrations_id, created_at ASC, id ASC
      ) first_mapping
      WHERE im.id = first_mapping.id;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_integration_mappings_primary
        ON integration_mappings (entity_type, internal_id, integrations_id)
        WHERE is_primary;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_integration_mappings_primary;',
    );
    await queryInterface.removeColumn('integration_mappings', 'is_primary');
  },
};
