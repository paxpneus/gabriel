'use strict';

// Role "Afiliado" sem permissões: afiliado só usa o login/me próprio (contacts /with-user resolve a role pelo nome).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO roles (id, name, type, permissions, created_at, updated_at)
      SELECT gen_random_uuid(), 'Afiliado', 'USER', '[]', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Afiliado');
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM roles WHERE name = 'Afiliado';`);
  },
};
