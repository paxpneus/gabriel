'use strict';

// Backfill pontual: preenche `name` (m278) pras regras já existentes, com a
// MESMA fórmula que buildSupplierDiscountRuleName (helpers/build-name.ts)
// usa daqui pra frente em toda criação/edição — ex.:
// "Dinâmica Promocional - A cada 2 Pneus - Marcas: Pirelli, Goodyear - Aros:
// 15, 16 - Lojas: Loja Centro - Desconto de 400 Reais - Entre 06/08/2026 e
// 08/08/2026". Eixo vazio (curinga) vira "Todas as marcas"/"Todos os
// aros"/"Todas as lojas"; mais de 3 valores selecionados lista só os 3
// primeiros (ordem alfabética/numérica) + "+N" restantes — mesmo corte que
// formatAxis faz em JS. Loja usa `number` quando tem, senão `name` (mesma
// regra do service). O duplo regexp_replace tira zeros à direita de
// discount_value (15.00 -> "15", 15.50 -> "15.5"), igual `Number(...)` faz
// em JS. `WHERE name IS NULL` torna seguro rodar de novo. Datas convertidas
// pra America/Sao_Paulo antes de formatar, mesmo padrão de m245.
const BUILD_NAME_SQL = `
  'Dinâmica Promocional - A cada ' || r.quantity_step::text || ' Pneus' ||
  ' - Marcas: ' || (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 'Todas as marcas'
      WHEN COUNT(*) > 3 THEN string_agg(b.name, ', ') FILTER (WHERE b.rn <= 3) || ' +' || (COUNT(*) - 3)::text
      ELSE string_agg(b.name, ', ')
    END
    FROM (
      SELECT br.name, ROW_NUMBER() OVER (ORDER BY br.name) AS rn
      FROM supplier_discount_rule_brands x
      JOIN brands br ON br.id = x.brand_id
      WHERE x.supplier_discount_rule_id = r.id
    ) b
  ) ||
  ' - Aros: ' || (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 'Todos os aros'
      WHEN COUNT(*) > 3 THEN string_agg(rm.value, ', ') FILTER (WHERE rm.rn <= 3) || ' +' || (COUNT(*) - 3)::text
      ELSE string_agg(rm.value, ', ')
    END
    FROM (
      SELECT ri.value, ROW_NUMBER() OVER (ORDER BY ri.value) AS rn
      FROM supplier_discount_rule_rims x
      JOIN rims ri ON ri.id = x.rim_id
      WHERE x.supplier_discount_rule_id = r.id
    ) rm
  ) ||
  ' - Lojas: ' || (
    SELECT CASE
      WHEN COUNT(*) = 0 THEN 'Todas as lojas'
      WHEN COUNT(*) > 3 THEN string_agg(ub.label, ', ') FILTER (WHERE ub.rn <= 3) || ' +' || (COUNT(*) - 3)::text
      ELSE string_agg(ub.label, ', ')
    END
    FROM (
      SELECT
        COALESCE(NULLIF(u.number, ''), u.name) AS label,
        ROW_NUMBER() OVER (ORDER BY COALESCE(NULLIF(u.number, ''), u.name)) AS rn
      FROM supplier_discount_unit_businesses x
      JOIN unit_businesses u ON u.id = x.unit_business_id
      WHERE x.supplier_discount_rule_id = r.id
    ) ub
  ) ||
  ' - Desconto de ' ||
  regexp_replace(regexp_replace(r.discount_value::text, '0+$', ''), '\\.$', '') ||
  ' ' || (CASE WHEN r.discount_type = 'PERCENTUAL' THEN '%' ELSE 'Reais' END) ||
  ' - Entre ' || to_char(r.start_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') ||
  ' e ' || to_char(r.end_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')
`;

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        UPDATE supplier_discount_rules AS r
        SET name = ${BUILD_NAME_SQL}
        WHERE r.name IS NULL
        `,
        { transaction },
      );

      await queryInterface.changeColumn(
        'supplier_discount_rules',
        'name',
        { type: Sequelize.STRING(255), allowNull: false },
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('supplier_discount_rules', 'name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },
};
