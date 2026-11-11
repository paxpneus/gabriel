'use strict';

// Carta de correção da nota (libera nota CD 12/17 sem transferência) + justificativa no romaneio do lote.
const COLUMNS = [
  ['invoices', 'correction_letter_path', (S) => ({ type: S.TEXT, allowNull: true })],
  ['invoices', 'correction_letter_attached_at', (S) => ({ type: S.DATE, allowNull: true })],
  ['expedition_batches', 'correction_letter_justification', (S) => ({ type: S.TEXT, allowNull: true })],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, column, definition] of COLUMNS) {
        await queryInterface.addColumn(table, column, definition(Sequelize), { transaction });
      }
    });
    // Fora da transação: valor novo de enum só pode ser usado depois do commit.
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_temp_files_entity_type"
      ADD VALUE IF NOT EXISTS 'INVOICE_CORRECTION_LETTER';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, column] of [...COLUMNS].reverse()) {
        await queryInterface.removeColumn(table, column, { transaction });
      }
    });
    // Postgres não permite remover valores de enum diretamente.
  },
};
