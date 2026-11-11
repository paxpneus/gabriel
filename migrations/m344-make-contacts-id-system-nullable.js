'use strict';

// id_system opcional: contato criado via /with-user (ex.: afiliado) não tem id do Bling. custom_data já existe (m337).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('contacts', 'id_system', { type: Sequelize.STRING(100), allowNull: true });
  },

  // Volta pra NOT NULL: falha se já houver contato sem id_system.
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('contacts', 'id_system', { type: Sequelize.STRING(100), allowNull: false });
  },
};
