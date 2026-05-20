'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'invoice_operation_snapshots',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          invoice_id: {
            type: Sequelize.UUID,
            allowNull: false,
            unique: true,
            references: { model: 'invoices', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          transporter_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'transporters', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          type: {
            type: Sequelize.STRING(20),
            allowNull: false,
          },
          invoice_date: {
            type: Sequelize.DATEONLY,
            allowNull: true,
          },
          emitted_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          delivery_note_generated_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          first_scan_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          last_scan_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          fully_processed_at: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          total_items_expected: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          total_items_received: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          scan_completion_pct: {
            type: Sequelize.DECIMAL(5, 2),
            defaultValue: 0,
          },
          minutes_emission_to_delivery_note: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          minutes_batch_to_fully_scanned: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          snapshot_status: {
            type: Sequelize.STRING(20),
            defaultValue: 'open',
          },
          last_updated_at: {
            type: Sequelize.DATE,
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
        },
        { transaction },
      );

      await queryInterface.addIndex('invoice_operation_snapshots', ['unit_business_id', 'invoice_date'], {
        name: 'idx_ios_unit_date',
        transaction,
      });
      await queryInterface.addIndex('invoice_operation_snapshots', ['type'], {
        name: 'idx_ios_type',
        transaction,
      });
      await queryInterface.addIndex('invoice_operation_snapshots', ['snapshot_status'], {
        name: 'idx_ios_snapshot_status',
        transaction,
      });
      await queryInterface.addIndex('invoice_operation_snapshots', ['fully_processed_at'], {
        name: 'idx_ios_fully_processed_at',
        transaction,
      });
      await queryInterface.addIndex('invoice_operation_snapshots', ['invoice_date'], {
        name: 'idx_ios_invoice_date',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('invoice_operation_snapshots', {
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
