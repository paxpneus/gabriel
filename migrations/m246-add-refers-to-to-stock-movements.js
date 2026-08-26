'use strict';

// Coluna-âncora: quando um MANUAL_ADJUSTMENT corrige o custo de uma
// PURCHASE_ENTRY específica, refers_to guarda o invoice_number dessa
// PURCHASE_ENTRY (não o id da linha). invoice_number é estável através de
// delete+recreate (reindexProduct apaga/recria PURCHASE_ENTRY normalmente,
// só o id muda, o invoice_number da mesma nota continua o mesmo) — por isso
// não é uma FK, é uma chave de correlação.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('stock_movements', 'refers_to', {
      type: Sequelize.STRING(100),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('stock_movements', 'refers_to');
  },
};
