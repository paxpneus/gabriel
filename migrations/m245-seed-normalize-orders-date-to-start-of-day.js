'use strict';

// Backfill pontual: normaliza orders.date pra meia-noite no timezone da
// aplicação (America/Sao_Paulo), mesma regra que bling-order.service.ts
// passou a aplicar (via startOfDayTz) na criação/atualização de pedidos.
// Pedidos já existentes foram gravados com o horário exato que o Bling
// mandou — este seed leva todos pro início do dia LOCAL correspondente,
// convertendo primeiro pra America/Sao_Paulo antes de truncar (não pode
// truncar em UTC direto, senão pedidos de madrugada UTC — noite anterior
// no Brasil — cairiam no dia errado).
// Ex.: 2026-08-06 21:00 UTC (= 2026-08-06 18:00 local) -> 2026-08-06 03:00 UTC
// (= 2026-08-06 00:00 local).
const NORMALIZE_TO_START_OF_LOCAL_DAY_SQL = `
  date_trunc('day', date AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
`;

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        UPDATE orders
        SET date = ${NORMALIZE_TO_START_OF_LOCAL_DAY_SQL}
        WHERE date IS NOT NULL
          AND date IS DISTINCT FROM (${NORMALIZE_TO_START_OF_LOCAL_DAY_SQL})
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Irreversível: o horário original de dentro do dia não fica guardado em
  // lugar nenhum depois do up, não há como reconstruir.
  async down() {},
};
