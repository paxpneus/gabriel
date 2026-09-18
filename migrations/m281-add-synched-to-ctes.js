'use strict';

// synched indica se o CT-e já foi enviado (importado) pra API da Datafrete.
// false = ainda não sincronizado; true = já confirmado lá, não reenviar.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ctes', 'synched', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ctes', 'synched');
  },
};
