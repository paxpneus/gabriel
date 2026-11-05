'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const userFk = {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    };
    await queryInterface.addColumn('tickets', 'opened_by', userFk);
    await queryInterface.addColumn('tickets', 'closed_by', userFk);

    // Backfill: até aqui o histórico gravava o solicitante como autor da abertura.
    await queryInterface.sequelize.query(`UPDATE tickets SET opened_by = requester_user_id`);
    // Fechados: autor da última mudança pra status concluído/cancelado.
    await queryInterface.sequelize.query(`
      UPDATE tickets t SET closed_by = (
        SELECT h.changed_by_user_id FROM ticket_status_histories h
        JOIN ticket_statuses s ON s.id = h.status_id
        WHERE h.ticket_id = t.id AND (s.completed OR s.canceled)
        ORDER BY h.changed_at DESC LIMIT 1
      )
      WHERE t.completed_at IS NOT NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tickets', 'closed_by');
    await queryInterface.removeColumn('tickets', 'opened_by');
  },
};
