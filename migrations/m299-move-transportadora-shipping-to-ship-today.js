'use strict';

// Separada da m298: o valor novo do enum só pode ser usado depois do commit dela.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE pdv_sales_requests
      SET status = 'SHIP_TODAY'
      WHERE status = 'SHIPPING' AND shipping_type = 'TRANSPORTADORA';
    `);
    await queryInterface.sequelize.query(`
      UPDATE pdv_sales_requests
      SET correction_origin_status = 'SHIP_TODAY'
      WHERE correction_origin_status = 'SHIPPING' AND shipping_type = 'TRANSPORTADORA';
    `);
  },

  async down() {
    // Sem volta: não dá pra saber quais já estavam em SHIP_TODAY antes.
  },
};
