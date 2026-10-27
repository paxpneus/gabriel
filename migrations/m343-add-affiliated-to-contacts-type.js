'use strict';

// AFFILIATED: vendedor afiliado (login próprio, loja 21, comissão por cupom).
// ADD VALUE fica em arquivo próprio e fora de transação (Postgres não usa o valor novo na mesma transação).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_contacts_type"
      ADD VALUE IF NOT EXISTS 'AFFILIATED';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
