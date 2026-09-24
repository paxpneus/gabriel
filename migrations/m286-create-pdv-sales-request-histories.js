'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pdv_sales_request_histories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      pdv_sales_request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'pdv_sales_requests',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // Reaproveita o MESMO enum de status da solicitação — nunca redefinido
      // separadamente, pra não divergir ("step sincronizado com o status").
      step: {
        type: Sequelize.ENUM(
          'OPEN',
          'PENDING_FINANCE',
          'PENDING_CD21_ANALYSIS',
          'PENDING_CORRECTION',
          'PENDING_NF_SALE',
          'PENDING_NF_TRANSFER',
          'SHIPPING',
          'FINISHED',
          'CANCELLED',
          'INVOICE_CANCELLED',
        ),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
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

    await queryInterface.addIndex(
      'pdv_sales_request_histories',
      ['pdv_sales_request_id'],
      { name: 'idx_pdv_sales_request_histories_request_id' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pdv_sales_request_histories');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_pdv_sales_request_histories_step";',
    );
  },
};
