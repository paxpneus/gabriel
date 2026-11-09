'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Nota que entrou no lote de uma loja que não é emissora nem destinatária (transbordo): sem conferência Tecinco.
    await queryInterface.addColumn('expedition_batch_invoices', 'is_transshipment', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Loja de transbordo tem 2 linhas por nota (entrada e expedição); as demais seguem com 1.
    await queryInterface.removeIndex(
      'invoice_unit_business_attributes',
      'uq_invoice_unit_business_attributes_invoice_unit_business',
    );
    await queryInterface.addIndex(
      'invoice_unit_business_attributes',
      ['invoice_id', 'unit_business_id', 'type'],
      {
        unique: true,
        name: 'uq_invoice_unit_business_attributes_invoice_unit_business_type',
      },
    );
  },

  async down(queryInterface) {
    // Falha se já houver nota com 2 linhas (entrada + expedição) na mesma loja.
    await queryInterface.removeIndex(
      'invoice_unit_business_attributes',
      'uq_invoice_unit_business_attributes_invoice_unit_business_type',
    );
    await queryInterface.addIndex(
      'invoice_unit_business_attributes',
      ['invoice_id', 'unit_business_id'],
      {
        unique: true,
        name: 'uq_invoice_unit_business_attributes_invoice_unit_business',
      },
    );
    await queryInterface.removeColumn('expedition_batch_invoices', 'is_transshipment');
  },
};
