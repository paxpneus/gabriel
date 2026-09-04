'use strict';

// Até aqui só existia `reason` (texto livre, específico da situação) — sem
// forma de filtrar/agrupar por categoria de erro. `type` classifica cada
// linha em uma das 4 origens possíveis no sistema hoje, sem repetir o nome
// da integração (isso já está em `integrations_id`):
//
// - ERROR_CATALOG: sync de catálogo (Bling/Tecinco, exclusivo dessas duas
//   filas) não achou mapping pro produto — é o único tipo elegível pra
//   criação automática de Product via `external_id` (ver
//   UnmappedInvoiceProductService.createProduct).
// - ERROR_INTEGRATION: cross-check contra outro sistema que não é o ERP de
//   origem do produto (hoje só Magento) — exige apenas mapeamento, nunca
//   cria Product a partir daqui.
// - ERROR_INVOICE: item de nota fiscal (NF-e/API) sem produto
//   correspondente — sempre tem invoice_id.
// - ERROR_SCAN: leitura manual de EAN por foto (createUnmappedFromReadingEan)
//   que não bateu com nenhum produto — fluxo de conferência de estoque, não
//   relacionado a sync nem a nota.
//
// Backfill por texto de `reason` porque `invoice_id IS NULL` sozinho não
// distingue ERROR_CATALOG/ERROR_INTEGRATION/ERROR_SCAN (nenhum dos três
// tem invoice_id).
module.exports = {
  async up(queryInterface, Sequelize) {
    // Idempotente: sequelize-cli não roda a migration inteira numa
    // transação por padrão, então uma falha a meio caminho (ex.: o cast
    // que este arquivo precisou corrigir) já deixa o ADD COLUMN commitado
    // — rodar de novo não pode tentar adicionar a coluna outra vez.
    const table = await queryInterface.describeTable(
      'unmapped_invoice_products',
    );

    if (!table.type) {
      await queryInterface.addColumn('unmapped_invoice_products', 'type', {
        type: Sequelize.ENUM(
          'ERROR_CATALOG',
          'ERROR_INTEGRATION',
          'ERROR_INVOICE',
          'ERROR_SCAN',
        ),
        allowNull: true,
      });
    }

    // O CASE abaixo resolve pra `text` por padrão (literais sem contexto de
    // tipo) — precisa de cast explícito pro enum recém-criado, senão
    // Postgres recusa a atribuição ("column is of type ... but expression
    // is of type text"). `WHERE type IS NULL` torna o backfill seguro de
    // rodar de novo sem sobrescrever linhas já classificadas.
    await queryInterface.sequelize.query(`
      UPDATE unmapped_invoice_products
      SET type = (CASE
        WHEN reason ILIKE '%magento%' THEN 'ERROR_INTEGRATION'
        WHEN reason ILIKE '%verificar ERP para ajustar cadastro%' THEN 'ERROR_SCAN'
        WHEN invoice_id IS NOT NULL THEN 'ERROR_INVOICE'
        ELSE 'ERROR_CATALOG'
      END)::"enum_unmapped_invoice_products_type"
      WHERE type IS NULL;
    `);

    await queryInterface.changeColumn('unmapped_invoice_products', 'type', {
      type: Sequelize.ENUM(
        'ERROR_CATALOG',
        'ERROR_INTEGRATION',
        'ERROR_INVOICE',
        'ERROR_SCAN',
      ),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('unmapped_invoice_products', 'type');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_unmapped_invoice_products_type";',
    );
  },
};
