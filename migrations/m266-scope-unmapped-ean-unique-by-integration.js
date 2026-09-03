'use strict';

// unique_ean_null_invoice (criada em
// 20260505153614-added-unique-per-ean-invoice-unmapped.js) é
// UNIQUE(ean) WHERE invoice_id IS NULL — global, sem escopo por integração.
// Isso bloqueia incorretamente o caso legítimo de duas integrações
// diferentes (ex: Bling e Tecinco) verem produtos de catálogo distintos que
// compartilham o mesmo EAN — colisão de EAN só é significativa dentro da
// mesma integração (ver princípio já documentado em
// ean-collision-is-only-meaningful-within-same-integration). Troca a
// constraint por uma composta (ean, integrations_id), mantendo o mesmo
// escopo parcial (WHERE invoice_id IS NULL).
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex(
      'unmapped_invoice_products',
      'unique_ean_null_invoice',
    );

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX unique_ean_integration_null_invoice
      ON unmapped_invoice_products (ean, integrations_id)
      WHERE invoice_id IS NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'unmapped_invoice_products',
      'unique_ean_integration_null_invoice',
    );

    await queryInterface.addIndex('unmapped_invoice_products', ['ean'], {
      unique: true,
      where: {
        invoice_id: null,
      },
      name: 'unique_ean_null_invoice',
    });
  },
};
