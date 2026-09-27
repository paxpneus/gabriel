'use strict';

// Sem constraint, um race entre 2 conferentes bipando o mesmo produto novo
// (ainda sem item no lote) ao mesmo tempo podia gerar 2 linhas de
// inventory_batch_items pro mesmo (inventory_batch_id, product_id) —
// "SELECT ... FOR UPDATE" não trava nada quando a linha ainda não existe.
// Antes de travar com o índice único, remove duplicatas existentes mantendo
// a linha com maior quantity_read (contagem mais completa); as demais são
// deletadas (cascade em inventory_batch_logs) e não são recuperáveis.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY inventory_batch_id, product_id
              ORDER BY quantity_read DESC, updated_at DESC
            ) AS rn
          FROM inventory_batch_items
        )
        DELETE FROM inventory_batch_items
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
        `,
        { transaction },
      );

      await queryInterface.addIndex(
        'inventory_batch_items',
        ['inventory_batch_id', 'product_id'],
        {
          unique: true,
          name: 'uq_inventory_batch_items_batch_product',
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    // Duplicatas removidas no up() não são recuperáveis aqui — só reverte o índice.
    await queryInterface.removeIndex(
      'inventory_batch_items',
      'uq_inventory_batch_items_batch_product',
    );
  },
};
