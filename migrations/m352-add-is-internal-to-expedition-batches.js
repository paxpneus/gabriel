'use strict';

// Lote de nota interna (série B Tecinco): separa dos lotes de NF-e nas consultas/ações atuais. Só o domínio internal/ grava true.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'is_internal', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('expedition_batches', 'is_internal');
  },
};
