'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('ticket_status_histories', {
    id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
    ticket_id: { type: Sequelize.BIGINT, allowNull: false, references: { model: 'tickets', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
    status_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'ticket_statuses', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
    changed_by_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
    changed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
  }),
  down: queryInterface => queryInterface.dropTable('ticket_status_histories'),
};
