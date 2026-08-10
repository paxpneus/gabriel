'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'ctes',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          xml_key: {
            type: Sequelize.STRING(44),
            allowNull: false,
            unique: true,
          },
          number: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          series: {
            type: Sequelize.INTEGER,
            allowNull: false,
          },
          total_value: {
            type: Sequelize.DECIMAL(15, 2),
            allowNull: false,
          },
          issue_date: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          operation_date: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          issuer_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: false,
          },
          sender_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: true,
          },
          recipient_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: true,
          },
          dispatcher_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: true,
          },
          receiver_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: true,
          },
          taker_type: {
            type: Sequelize.ENUM(
              'ISSUER',
              'DISPATCHER',
              'RECEIVER',
              'ADDRESSEE',
              'THIRD_PARTY'
            ),
            allowNull: true,
          },
          taker_tax_id: {
            type: Sequelize.STRING(14),
            allowNull: true,
          },
          xml_path: {
            type: Sequelize.STRING(255),
            allowNull: true,
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
        },
        { transaction },
      );

      // Índices para otimização de consultas frequentes
      await queryInterface.addIndex(
        'ctes',
        ['xml_key'],
        {
          name: 'ctes_xml_key_unique_idx',
          unique: true,
          transaction,
        },
      );

      await queryInterface.addIndex(
        'ctes',
        ['issuer_tax_id', 'issue_date'],
        {
          name: 'ctes_issuer_issue_date_idx',
          transaction,
        },
      );

      await queryInterface.addIndex(
        'ctes',
        ['recipient_tax_id'],
        {
          name: 'ctes_recipient_tax_id_idx',
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('ctes', { transaction });
      
      // Remove o tipo ENUM criado no Postgres para evitar conflitos em re-execuções
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_ctes_taker_type";',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};