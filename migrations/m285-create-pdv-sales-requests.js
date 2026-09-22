'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pdv_sales_requests', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      // Sem unique — uma mesma order pode ter mais de uma solicitação ao
      // longo do tempo (ex.: depois de CANCELLED/INVOICE_CANCELLED). Quem
      // impede duas solicitações ATIVAS pro mesmo pedido é o service
      // (findActiveByOrderId), não uma constraint de banco.
      order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'orders',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // Espelhado automaticamente de order.invoice_id pelo service — nunca
      // setado via API.
      sale_invoice_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'invoices',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // Só relevante quando shipping_type = ADT.
      transfer_invoice_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'invoices',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
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
        defaultValue: 'OPEN',
      },
      correction_origin_status: {
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
        allowNull: true,
      },
      shipping_type: {
        type: Sequelize.ENUM('TRANSPORTADORA', 'ADT'),
        allowNull: true,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      payment_receipt_path: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      errors: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_by_user_id: {
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

    await queryInterface.addIndex('pdv_sales_requests', ['order_id'], {
      name: 'idx_pdv_sales_requests_order_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pdv_sales_requests');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_pdv_sales_requests_status";',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_pdv_sales_requests_correction_origin_status";',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_pdv_sales_requests_shipping_type";',
    );
  },
};
