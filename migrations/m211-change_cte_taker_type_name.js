'use strict';

// Nome do tipo enum gerado pelo Sequelize segue o padrão enum_<table>_<column>.
// Se o seu projeto usa outra convenção de nomenclatura de enums, ajuste a constante abaixo.
const ENUM_TYPE_NAME = 'enum_ctes_taker_type';

module.exports = {
  async up(queryInterface) {
    // RENAME VALUE (Postgres 10+) relabela automaticamente as linhas existentes
    // que já tinham 'ISSUER' — não precisa de UPDATE manual na tabela.
    await queryInterface.sequelize.query(
      `ALTER TYPE "${ENUM_TYPE_NAME}" RENAME VALUE 'ISSUER' TO 'SENDER';`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "${ENUM_TYPE_NAME}" RENAME VALUE 'SENDER' TO 'ISSUER';`,
    );
  },
};