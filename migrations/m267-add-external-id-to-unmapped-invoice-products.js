'use strict';

// Guarda o id do produto no ERP de origem (Bling produtoId / Tecinco
// epctb_codigo) quando ele é conhecido com confiança — só preenchido nos
// fluxos de sincronização de catálogo, nunca nos de importação de nota
// (onde o único código disponível é o do fornecedor, não do ERP). Usado
// para permitir criar um Product real a partir de uma linha unmapped.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('unmapped_invoice_products', 'external_id', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('unmapped_invoice_products', 'external_id');
  },
};
