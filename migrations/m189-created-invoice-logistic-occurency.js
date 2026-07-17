'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'invoice_logistic_occurrences',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },

          invoice_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'invoices',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },

          occurrency_code: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },

          date: {
            type: Sequelize.DATE,
            allowNull: false,
          },

          description: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },

          proof_link: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },

          status: {
            type: Sequelize.ENUM('PENDING', 'SYNCHRONIZED'),
            allowNull: false,
            defaultValue: 'PENDING',
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
        { transaction }
      );

      await queryInterface.addConstraint(
        'invoice_logistic_occurrences',
        {
          fields: ['invoice_id', 'occurrency_code', 'date'],
          type: 'unique',
          name: 'uq_invoice_logistic_occurrences_invoice_code_date',
          transaction,
        }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable(
        'invoice_logistic_occurrences',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};