'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // description virou referência da transferência (PDV/lote) e bonded_invoice o vínculo saída ⇄ devolução.
  async up(queryInterface) {
    await queryInterface.renameColumn('invoices', 'description', 'transfer_invoice_reference');
    await queryInterface.renameColumn('invoices', 'bonded_invoice', 'return_invoice_reference');
  },

  async down(queryInterface) {
    await queryInterface.renameColumn('invoices', 'transfer_invoice_reference', 'description');
    await queryInterface.renameColumn('invoices', 'return_invoice_reference', 'bonded_invoice');
  },
};
