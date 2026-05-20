'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'daily_operation_facts',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          fact_date: {
            type: Sequelize.DATEONLY,
            allowNull: false,
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          invoices_incoming_count: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_outgoing_count: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          volumes_received: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          volumes_dispatched: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_incoming_total: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_outgoing_total: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_incoming_fully_processed: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_outgoing_fully_processed: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          outgoing_perf_avg_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          outgoing_perf_min_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          outgoing_perf_max_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          outgoing_perf_invoice_count: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          incoming_perf_avg_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          incoming_perf_min_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          incoming_perf_max_minutes: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
          },
          incoming_perf_invoice_count: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
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

      await queryInterface.addConstraint('daily_operation_facts', {
        fields: ['fact_date', 'unit_business_id'],
        type: 'unique',
        name: 'daily_operation_facts_fact_date_unit_business_id_unique',
        transaction,
      });
      await queryInterface.addIndex('daily_operation_facts', ['fact_date'], {
        name: 'idx_dof_fact_date',
        transaction,
      });
      await queryInterface.addIndex('daily_operation_facts', ['unit_business_id'], {
        name: 'idx_dof_unit_business',
        transaction,
      });
      await queryInterface.addIndex('daily_operation_facts', ['fact_date', 'unit_business_id'], {
        name: 'idx_dof_date_unit',
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
      await queryInterface.dropTable('daily_operation_facts', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
