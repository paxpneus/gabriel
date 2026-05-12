'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoices
      ALTER COLUMN description DROP NOT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE expedition_batches
      ALTER COLUMN description DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    // ATENÇÃO: Se houver dados nulos nestas colunas, o comando abaixo falhará.
    // É necessário garantir que não existam valores nulos antes de SET NOT NULL.
    
    await queryInterface.sequelize.query(`
      ALTER TABLE invoices 
      ALTER COLUMN description SET NOT NULL;
    `);

     await queryInterface.sequelize.query(`
      ALTER TABLE expedition_batches
      ALTER COLUMN description SET NOT NULL;
    `);
  }
};