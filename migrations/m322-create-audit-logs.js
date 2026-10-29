'use strict';

// Tabela de auditoria genérica: quem (user_id), quando, qual entidade/id e o
// que mudou (description legível + changes estruturado) — gravada explicitamente pelas services.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      entity: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      internal_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      changes: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
    });

    // Consulta típica: histórico de uma entidade específica, mais recente primeiro.
    await queryInterface.addIndex('audit_logs', ['entity', 'internal_id', 'date'], {
      name: 'idx_audit_logs_entity_internal_id_date',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
