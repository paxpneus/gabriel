'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('pdv_sales_requests', 'payment_receipt_analysis', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('pdv_sales_requests', 'payment_receipt_validated', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });

    await queryInterface.addColumn('pdv_sales_requests', 'payment_receipt_fingerprint', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    await queryInterface.addColumn('pdv_sales_requests', 'payment_method_matches_receipt', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });

    // Duplicidade de comprovante (mesmo cnpj+data+hora+valor+instrumento) só
    // é bloqueada quando já existe uma análise — sem WHERE, o índice
    // rejeitaria a 2ª+ solicitação sem comprovante nenhum (fingerprint NULL).
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_pdv_sales_requests_receipt_fingerprint
        ON pdv_sales_requests (payment_receipt_fingerprint)
        WHERE payment_receipt_fingerprint IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_pdv_sales_requests_receipt_fingerprint;',
    );
    await queryInterface.removeColumn('pdv_sales_requests', 'payment_method_matches_receipt');
    await queryInterface.removeColumn('pdv_sales_requests', 'payment_receipt_fingerprint');
    await queryInterface.removeColumn('pdv_sales_requests', 'payment_receipt_validated');
    await queryInterface.removeColumn('pdv_sales_requests', 'payment_receipt_analysis');
  },
};
