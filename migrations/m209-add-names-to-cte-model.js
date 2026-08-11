'use strict';

const NAME_COLUMNS = [
  'issuer_name',
  'sender_name',
  'recipient_name',
  'dispatcher_name',
  'receiver_name',
  'taker_name',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const column of NAME_COLUMNS) {
      await queryInterface.addColumn('ctes', column, {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    for (const column of NAME_COLUMNS) {
      await queryInterface.removeColumn('ctes', column);
    }
  },
};