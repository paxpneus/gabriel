'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE transporters 
      ALTER COLUMN cnpj DROP NOT NULL,
      ALTER COLUMN city DROP NOT NULL,
      ALTER COLUMN uf DROP NOT NULL,
      ALTER COLUMN id_system DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    // ATENÇÃO: Se houver dados nulos nestas colunas, o comando abaixo falhará.
    // É necessário garantir que não existam valores nulos antes de SET NOT NULL.
    
    await queryInterface.sequelize.query(`
      ALTER TABLE transporters 
      ALTER COLUMN cnpj SET NOT NULL,
      ALTER COLUMN city SET NOT NULL,
      ALTER COLUMN uf SET NOT NULL,
      ALTER COLUMN id_system SET NOT NULL;
    `);
  }
};