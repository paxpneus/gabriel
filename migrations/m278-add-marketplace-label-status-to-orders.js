'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');

    if (!table.market_place_label_status) {
      await queryInterface.addColumn('orders', 'market_place_label_status', {
        type: Sequelize.ENUM(
          'UNKNOWN',
          'WAITING_FOR_SYSTEM_NFE',
          'WAITING_MARKETPLACE_PROCESS_NFE',
          'WAITING_MARKETPLACE_LABEL_GENERATION',
          'READY_TO_PRINT',
        ),
        allowNull: false,
        defaultValue: 'UNKNOWN',
      });
    }

    if (!table.market_place_label_printed) {
      await queryInterface.addColumn('orders', 'market_place_label_printed', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // reconcileStuckOrders para de gravar ML_SCRAPING_NO_MATCH quando o
    // ML-SCRAPING sai — precisa de um motivo novo pro mesmo "preso em
    // WAITING_CHANNEL_VALIDATION", agora causado por falha na API do
    // marketplace, não por scraping sem match. Valor antigo permanece no
    // enum/histórico, nunca removido (mesmo padrão de m271).
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_orders_reason_cancelled" ADD VALUE IF NOT EXISTS 'MARKETPLACE_SYNC_STUCK';
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'market_place_label_status');
    await queryInterface.removeColumn('orders', 'market_place_label_printed');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_orders_market_place_label_status";',
    );
    // Remoção de valor de enum_orders_reason_cancelled não é suportada pelo
    // Postgres — mesmo caso já documentado em m271.
  },
};
