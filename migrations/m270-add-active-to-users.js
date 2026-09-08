"use strict";

// Suporta o soft delete de usuário (user.service.ts): delete vira update
// pra active=false, e login passa a recusar usuários inativos.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("users", "active", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("users", "active");
  },
};
