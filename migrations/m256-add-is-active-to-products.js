"use strict";

// A partir de agora, produto nunca mais é deletado pelo sistema automatizado
// (Bling/Tecinco) — fica de histórico. Como não existia nenhuma coluna de
// status em `products`, essa migration adiciona `is_active` (default true)
// pra marcar quando a Tecinco/Bling sinalizarem que o produto não existe
// mais do lado deles, sem apagar a linha.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("products", "is_active", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("products", "is_active");
  },
};
