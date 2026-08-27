"use strict";

// Remove produtos que não pertencem aos grupos de pneus, como parte da
// validação de whitelist de grupo adicionada ao sync da Tecinco (só cria/
// atualiza produtos dos grupos abaixo — o resto passa a ser ignorado, mas
// o que já existia no banco de antes precisa ser limpo manualmente).
//
// Produtos com histórico real vinculado (nota fiscal, movimentação de
// estoque, lote de expedição/inventário, ou usado como componente de kit)
// NÃO são apagados — ficam no banco junto com seu grupo/subgrupo, mesmo
// fora da whitelist, pois apagar exigiria apagar também esse histórico
// (as FKs dessas tabelas para products são RESTRICT).
//
// Produtos sem grupo/subgrupo (subgroup_id nulo) também NÃO são apagados —
// vários deles são pneus de verdade que só nunca tiveram grupo atribuído
// (ex.: pneus Firestone/General Tire/Continental importados via Tecinco
// antes da whitelist), então apagar por falta de grupo destruiria produto
// (e possivelmente histórico) legítimo. Só produtos com subgrupo atribuído
// a um grupo fora da whitelist são removidos.
//
// Depois de remover os produtos, remove os grupos fora da whitelist que
// ficaram sem nenhum produto (subgroups são removidos em CASCADE junto
// com o group).
//
// Validado com dry-run (BEGIN/ROLLBACK): 17891 produtos apagados, 79
// mantidos (com histórico e/ou sem grupo), 7 grupos ficam vazios e são
// removidos.
//
// NOTA: esta migration já foi aplicada localmente (autointegration_node)
// ANTES da proteção a produtos sem grupo ter sido adicionada ao filtro —
// nessa execução local, produtos sem grupo e sem histórico também foram
// apagados. O Sequelize não reaplica migrations já marcadas como
// executadas, então esta versão corrigida só afeta ambientes onde a m251
// ainda não rodou (produção). A m252 foi ajustada para proteger os
// produtos sem grupo que sobraram no ambiente local.

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
        DELETE FROM products p
        WHERE p.subgroup_id IN (
            SELECT sg.id FROM subgroups sg
            JOIN groups g ON g.id = sg.group_id
            WHERE g.name NOT IN (:allowedGroups)
          )
          AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM expedition_batch_items ebi WHERE ebi.product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM inventory_batch_items ibi WHERE ibi.product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM operations_itens oi WHERE oi.product_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM kit_components kc WHERE kc.product_component_id = p.id);
        `,
        {
          replacements: { allowedGroups: ALLOWED_GROUPS },
          transaction,
        },
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
        {
          replacements: { allowedGroups: ALLOWED_GROUPS },
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    // Não reversível — produtos e grupos apagados não podem ser reconstruídos.
  },
};
