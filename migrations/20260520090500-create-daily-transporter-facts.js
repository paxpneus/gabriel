'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'daily_transporter_facts',
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
          transporter_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'transporters', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          volumes_dispatched: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_count: {
            type: Sequelize.INTEGER,
            defaultValue: 0,
          },
          invoices_fully_processed: {
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

      await queryInterface.addConstraint('daily_transporter_facts', {
        fields: ['fact_date', 'unit_business_id', 'transporter_id'],
        type: 'unique',
        name: 'daily_transporter_facts_date_unit_transporter_unique',
        transaction,
      });
      await queryInterface.addIndex('daily_transporter_facts', ['fact_date', 'unit_business_id'], {
        name: 'idx_dtf_date_unit',
        transaction,
      });
      await queryInterface.addIndex('daily_transporter_facts', ['transporter_id'], {
        name: 'idx_dtf_transporter',
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
      await queryInterface.dropTable('daily_transporter_facts', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
