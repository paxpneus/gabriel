'use strict';

// cloud_path = caminho do XML arquivado na nuvem. NULL = ainda não confirmado
// lá (o sweep do UploaderQueue reenfileira). Linhas antigas começam NULL e são
// resolvidas pelo sweep via HEAD, sem reenvio se o arquivo já existir.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ctes', 'cloud_path', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ctes', 'cloud_path');
  },
};
