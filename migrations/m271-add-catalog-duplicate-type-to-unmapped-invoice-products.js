'use strict';

// Adiciona um 5º valor ao enum já criado pelo m269 — não é ADD COLUMN,
// então não precisa do guard describeTable daquele: só falha de novo se o
// valor já existir, e `ADD VALUE IF NOT EXISTS` (Postgres 9.6+) já resolve
// isso sozinho. ERROR_CATALOG_DUPLICATE marca um produto sem
// mapping/Product ainda cujo sku/código de fábrica/ean colide com outro
// produto diferente dentro do próprio catálogo da Tecinco — ver
// migrateProdutos em tecinco-migration.runner.ts.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_unmapped_invoice_products_type"
      ADD VALUE IF NOT EXISTS 'ERROR_CATALOG_DUPLICATE';
    `);
  },

  async down() {
    // Postgres não suporta remover um valor de enum sem recriar o tipo
    // inteiro (e todas as colunas que o usam) — não vale o risco aqui.
    // Se precisar reverter de verdade, é uma migration manual dedicada.
  },
};
