'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // ADD VALUE fica fora de transação: o valor novo não pode ser usado na mesma transação que o criou.
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE enum_contacts_type ADD VALUE IF NOT EXISTS 'AFFILIATED';`
    );
  },

  // Postgres não remove valor de ENUM sem recriar o tipo.
  async down() {},
};
