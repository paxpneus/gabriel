'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Loja de transbordo tem entrada e expedição da mesma nota: uma linha de snapshot por type.
    await queryInterface.removeConstraint(
      'invoice_operation_snapshots',
      'invoice_operation_snapshots_invoice_unit_business_key',
    );
    await queryInterface.addConstraint('invoice_operation_snapshots', {
      fields: ['invoice_id', 'unit_business_id', 'type'],
      type: 'unique',
      name: 'invoice_operation_snapshots_invoice_unit_business_type_key',
    });

    // "Entrada transbordo"/"Saída transbordo": loja nem emissora nem destinatária (expedition_batch_invoices.is_transshipment).
    await queryInterface.addColumn('invoice_operation_snapshots', 'is_transshipment', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Transbordo conta à parte no fato do dia, fora dos indicadores normais (como adiantamento).
    await queryInterface.addColumn('daily_operation_facts', 'transshipment_incoming_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('daily_operation_facts', 'transshipment_outgoing_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    // Falha se já houver nota com entrada e expedição na mesma loja.
    await queryInterface.removeColumn('daily_operation_facts', 'transshipment_outgoing_count');
    await queryInterface.removeColumn('daily_operation_facts', 'transshipment_incoming_count');
    await queryInterface.removeColumn('invoice_operation_snapshots', 'is_transshipment');
    await queryInterface.removeConstraint(
      'invoice_operation_snapshots',
      'invoice_operation_snapshots_invoice_unit_business_type_key',
    );
    await queryInterface.addConstraint('invoice_operation_snapshots', {
      fields: ['invoice_id', 'unit_business_id'],
      type: 'unique',
      name: 'invoice_operation_snapshots_invoice_unit_business_key',
    });
  },
};
