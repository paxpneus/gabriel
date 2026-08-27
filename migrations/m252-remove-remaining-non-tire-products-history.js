"use strict";

// Continuação da m251: remove os produtos fora da whitelist de grupos de
// pneus que a m251 manteve por terem histórico vinculado (nota fiscal,
// movimentação de estoque, lote de expedição/inventário, ou uso como
// componente de kit). Diferente da m251, aqui o histórico é apagado junto
// com o produto — não fica órfão.
//
// Exceções — produtos que NÃO são apagados mesmo fora da whitelist:
// 1) Movimentação de estoque MANUAL_ADJUSTMENT com refers_to preenchido. Um
//    trigger do banco (trigger_prevent_delete_manual_adjustment_with_cost)
//    proíbe excluir esse tipo de linha — proteção de integridade de custo,
//    provavelmente porque outras movimentações se ancoram nela via
//    refers_to.
// 2) Produtos sem grupo/subgrupo (subgroup_id nulo) — vários são pneus de
//    verdade que nunca tiveram grupo atribuído (mesmo motivo da m251).
// Esses produtos ficam no banco junto com seu grupo/subgrupo (quando têm).
//
// Depois de remover os produtos, remove os grupos fora da whitelist que
// ficaram sem nenhum produto (subgroups em CASCADE).
//
// Validado com dry-run (BEGIN/ROLLBACK) contra o estado atual do banco
// local (após a m251 já ter rodado): 58 produtos apagados com todo o
// histórico, 8 grupos ficam vazios e são removidos, 21 produtos sem grupo
// permanecem intocados — ao final restam só os 4 grupos da whitelist.

const ALLOWED_GROUPS = [
  "PNEUS",
  "PNEUS CARGA",
  "PNEUS IMPORTADOS",
  "PNEUS BRIDGESTONE/ FIRESTONE",
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        CREATE TEMP TABLE m252_alvo AS
        SELECT p.id FROM products p
        JOIN subgroups sg ON sg.id = p.subgroup_id
        JOIN groups g ON g.id = sg.group_id
        WHERE g.name NOT IN (:allowedGroups)
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
            WHERE sm.product_id = p.id
              AND sm.movement_type = 'MANUAL_ADJUSTMENT'
              AND sm.refers_to IS NOT NULL
          );
        `,
        { replacements: { allowedGroups: ALLOWED_GROUPS }, transaction },
      );

      await queryInterface.sequelize.query(
        `DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM invoice_items WHERE product_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM expedition_batch_items WHERE product_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM inventory_batch_items WHERE product_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM operations_itens WHERE product_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM kit_components WHERE product_component_id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM products WHERE id IN (SELECT id FROM m252_alvo);`,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        DELETE FROM groups g
        WHERE g.name NOT IN (:allowedGroups)
          AND NOT EXISTS (
            SELECT 1 FROM subgroups sg
            JOIN products p ON p.subgroup_id = sg.id
            WHERE sg.group_id = g.id
          );
        `,
        { replacements: { allowedGroups: ALLOWED_GROUPS }, transaction },
      );

      await queryInterface.sequelize.query(`DROP TABLE m252_alvo;`, {
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    // Não reversível — produtos, histórico e grupos apagados não podem ser
    // reconstruídos.
  },
};
