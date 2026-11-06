'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Parcelas e bandeira vêm da forma da Bling (condicao / dadosCartao.bandeira):
    // a Bling tem uma forma por parcela+bandeira, o hub só a forma genérica.
    await queryInterface.addColumn('order_payments', 'installments', {
      type: Sequelize.SMALLINT,
      allowNull: true,
    });
    // Código de bandeira da NF-e (1 Visa, 2 Mastercard...) — ver CARD_BRAND_NAMES.
    await queryInterface.addColumn('order_payments', 'card_brand', {
      type: Sequelize.SMALLINT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('order_payments', 'card_brand');
    await queryInterface.removeColumn('order_payments', 'installments');
  },
};
