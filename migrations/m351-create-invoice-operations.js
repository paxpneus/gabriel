'use strict';

// Operação da nota (venda, compra, transferência, devolução, transferência interna) + FK na invoices.
// Codes provisórios: se trocar, trocar também INVOICE_OPERATION_CODES (invoice-operation.types.ts).
const OPERATIONS = [
  ['10', 'Venda de mercadoria'],
  ['20', 'Compra de mercadoria'],
  ['30', 'Transferência de produtos'],
  ['40', 'Devolução de mercadoria'],
  ['50', 'Transferência interna'],
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'invoice_operations',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
            allowNull: false,
          },
          code: {
            type: Sequelize.STRING(20),
            allowNull: false,
            unique: true,
          },
          description: {
            type: Sequelize.STRING(100),
            allowNull: false,
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW,
          },
        },
        { transaction },
      );

      // Idempotente: rodar de novo não duplica nem estoura a unique do code.
      for (const [code, description] of OPERATIONS) {
        await queryInterface.sequelize.query(
          `INSERT INTO invoice_operations (id, code, description, created_at, updated_at)
           SELECT gen_random_uuid(), :code, :description, NOW(), NOW()
           WHERE NOT EXISTS (SELECT 1 FROM invoice_operations WHERE code = :code);`,
          { replacements: { code, description }, transaction },
        );
      }

      await queryInterface.addColumn(
        'invoices',
        'invoice_operation_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'invoice_operations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        { transaction },
      );
      await queryInterface.addIndex('invoices', ['invoice_operation_id'], { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('invoices', ['invoice_operation_id'], { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_operation_id', { transaction });
      await queryInterface.dropTable('invoice_operations', { transaction });
    });
  },
};
