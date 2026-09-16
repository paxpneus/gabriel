'use strict';

// last_outgoing_batch_pending é um atalho: aponta pro último lote (expedition_batches)
// em que uma nota foi adicionada nessa unit_business. Atualizado via UPDATE simples
// pelo front sempre que uma nota é lançada num lote. Nullable porque nem toda
// unit_business necessariamente tem um lote pendente no momento.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('unit_businesses', 'last_outgoing_batch_pending', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'expedition_batches',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('unit_businesses', 'last_outgoing_batch_pending');
  },
};