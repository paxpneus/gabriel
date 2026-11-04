'use strict';

// SELLER_MANAGER: gerente da loja (contacts.unit_business_id); ganha a comissão de gerente das vendas com vendedor da loja.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_contacts_type"
      ADD VALUE IF NOT EXISTS 'SELLER_MANAGER';
    `);
  },

  async down() {
    // Postgres não permite remover valores de enum diretamente.
  },
};
