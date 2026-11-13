'use strict';

// Nota de venda → nota de transferência vinculada (1 ↔ 1). O número sozinho não identifica a transferência (repete entre CNPJs).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'invoices',
        'transfer_invoice_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'invoices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction },
      );
      await queryInterface.addIndex('invoices', ['transfer_invoice_id'], { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('invoices', ['transfer_invoice_id'], { transaction });
      await queryInterface.removeColumn('invoices', 'transfer_invoice_id', { transaction });
    });
  },
};
