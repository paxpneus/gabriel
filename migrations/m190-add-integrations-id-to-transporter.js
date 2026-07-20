'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('transporters', 'integrations_id', {
      type: Sequelize.UUID,
      references: {
        model: 'integrations',
        key: 'id'
      },
      onUpdate: 'SET NULL',
      onDelete: 'SET NULL',
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('transporters', 'integrations_id');
  }
};
