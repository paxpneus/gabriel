'use strict';

// Apagar contato com pedido/nota zerava o seller_id (SET NULL) e sumia com a comissão dele: agora o banco recusa (RESTRICT).
const FKS = [
  { table: 'orders', constraint: 'orders_seller_id_fkey' },
  { table: 'invoices', constraint: 'invoices_seller_id_fkey' },
];

// Recria a FK seller_id → contacts com o ON DELETE pedido (ON UPDATE CASCADE igual ao atual).
async function setSellerFkOnDelete(queryInterface, onDelete) {
  for (const { table, constraint } of FKS) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ${table}
        DROP CONSTRAINT ${constraint},
        ADD CONSTRAINT ${constraint} FOREIGN KEY (seller_id) REFERENCES contacts(id) ON UPDATE CASCADE ON DELETE ${onDelete}
    `);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await setSellerFkOnDelete(queryInterface, 'RESTRICT');
  },

  async down(queryInterface) {
    await setSellerFkOnDelete(queryInterface, 'SET NULL');
  },
};
