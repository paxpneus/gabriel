'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Nome original da forma na Bling (ex.: "Mercado Pago"), que o agrupamento
    // de payment_methods apaga — o front usa pra explicar o grupo "Outros".
    await queryInterface.addColumn('order_payments', 'form_description', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('order_payments', 'form_description');
  },
};
