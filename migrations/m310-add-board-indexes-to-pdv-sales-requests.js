'use strict';

// Quadro do Kanban (PdvSalesRequestRepository.findBoardColumnPage): status IN
// (...) + ordem (created_at, id), com ou sem loja. CONCURRENTLY não roda em
// transação — se falhar no meio, sobra índice INVALID pra DROP INDEX manual.
const TABLE = 'pdv_sales_requests';
const STATUS_INDEX = 'pdv_sales_requests_status_created_at_id_idx';
const UNIT_BUSINESS_INDEX = 'pdv_sales_requests_ub_status_created_at_id_idx';

module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex(TABLE, ['status', 'created_at', 'id'], {
      name: STATUS_INDEX,
      concurrently: true,
    });
    await queryInterface.addIndex(
      TABLE,
      ['unit_business_id', 'status', 'created_at', 'id'],
      { name: UNIT_BUSINESS_INDEX, concurrently: true },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(TABLE, UNIT_BUSINESS_INDEX, {
      concurrently: true,
    });
    await queryInterface.removeIndex(TABLE, STATUS_INDEX, {
      concurrently: true,
    });
  },
};
