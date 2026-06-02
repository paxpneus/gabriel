'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('applications', 'webhook_url', {
      type: Sequelize.STRING(2048),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('applications', 'webhook_url');
  },
};
