'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pdv_sales_request_receipts', {
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
      path: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      analysis: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      validated: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      fingerprint: {
        type: Sequelize.STRING(64),
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

    await queryInterface.addIndex(
      'pdv_sales_request_receipts',
      ['pdv_sales_request_id'],
      { name: 'idx_pdv_sales_request_receipts_request_id' },
    );

    // Duplicidade de comprovante (mesmo cnpj+data+hora+valor+instrumento) —
    // global entre TODAS as solicitações, não só dentro da mesma. Substitui
    // uq_pdv_sales_requests_receipt_fingerprint (m287), que vivia na própria
    // pdv_sales_requests quando só cabia 1 comprovante por solicitação.
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_pdv_sales_request_receipts_fingerprint
        ON pdv_sales_request_receipts (fingerprint)
        WHERE fingerprint IS NOT NULL;
    `);

    // pdv_sales_requests passa a aceitar N comprovantes (1 linha por
    // comprovante na tabela nova acima) — payment_receipt_path (só 1
    // arquivo) e payment_receipt_fingerprint (dedup por solicitação) não
    // fazem mais sentido na própria solicitação. payment_receipt_analysis/
    // payment_receipt_validated/payment_method_matches_receipt continuam,
    // mas repassam a significar a CONCILIAÇÃO de todos os comprovantes
    // anexados (ver PdvSalesRequestService.reconcileReceipts), não mais a
    // análise de um único arquivo.
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_pdv_sales_requests_receipt_fingerprint;',
    );
    await queryInterface.removeColumn(
      'pdv_sales_requests',
      'payment_receipt_fingerprint',
    );
    await queryInterface.removeColumn(
      'pdv_sales_requests',
      'payment_receipt_path',
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('pdv_sales_requests', 'payment_receipt_path', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn(
      'pdv_sales_requests',
      'payment_receipt_fingerprint',
      {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
    );
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_pdv_sales_requests_receipt_fingerprint
        ON pdv_sales_requests (payment_receipt_fingerprint)
        WHERE payment_receipt_fingerprint IS NOT NULL;
    `);

    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_pdv_sales_request_receipts_fingerprint;',
    );
    await queryInterface.dropTable('pdv_sales_request_receipts');
  },
};
