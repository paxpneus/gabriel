'use strict';

const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `INSERT INTO roles (id, name, type, permissions, created_at, updated_at)
       SELECT :id, 'Afiliado', 'USER', '[]', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Afiliado');`,
      { replacements: { id: uuidv4() } }
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM roles WHERE name = 'Afiliado';`);
  },
};
