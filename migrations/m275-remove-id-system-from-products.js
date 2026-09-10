'use strict';

// Remove products.id_system por completo (coluna legada, única GLOBALMENTE
// — causa raiz de um incidente real de produção: um mesmo produto físico
// pode legitimamente ter mais de um external_id mapeado nele via
// integration_mappings, mas id_system só guarda um valor por vez, então
// sincronizar um external_id diferente podia tentar sobrescrever id_system
// pro valor que outro produto completamente diferente já era dono
// legítimo, travando o sync pra sempre no UNIQUE constraint).
//
// integration_mappings já é o mecanismo correto pra isso (chave composta
// entity_type+integrations_id+external_id, escopada por integração, sem
// esse limite). Todo código que lia id_system pra resolver produto (KIT do
// Bling, supplier mapping, fallback de estoque físico) já foi migrado pra
// usar integration_mappings antes desta migração.
//
// IMPORTANTE: rodar o backfill (INSERT em integration_mappings pra todo
// produto que hoje só é resolvível por id_system) como SQL avulso em prod
// ANTES desta migração — não está embutido aqui. Ver o SQL fornecido à
// parte (INSERT ... ON CONFLICT DO NOTHING, idempotente).
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS products_id_system_key;
        DROP INDEX IF EXISTS products_id_system_unique_idx;
        `,
        { transaction },
      );
      await queryInterface.removeColumn('products', 'id_system', { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn(
        'products',
        'id_system',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX products_id_system_key ON products (id_system) WHERE id_system IS NOT NULL;
        CREATE UNIQUE INDEX products_id_system_unique_idx ON products (id_system);
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
