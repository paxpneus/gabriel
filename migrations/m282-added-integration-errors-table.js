'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('integration_errors', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      entity: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      integrations_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'integrations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      external_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      internal_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      reference: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      message: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      resolved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      event_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'events',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      occurrences: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // Chave usada pelo upsert-by-find de IntegrationErrorService.recordError
    // (dedup + contador de occurrences para o mesmo erro). Combina
    // internal_id e external_id porque uma entidade pode não ter id na
    // integração externa (ex.: CT-e, identificado por chave/número em
    // `reference`) mas ter id interno, ou vice-versa.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_integration_errors_dedup
        ON integration_errors (entity, type, integrations_id, COALESCE(internal_id, ''), COALESCE(external_id, ''));
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_integration_errors_dedup;'
    );

    await queryInterface.dropTable('integration_errors');
  },
};
