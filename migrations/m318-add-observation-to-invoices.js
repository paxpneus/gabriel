'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // Observação livre da nota; obrigatória ao finalizar manualmente (InvoiceService.finishPendingInvoice).
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'observation', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoices', 'observation');
  },
};
