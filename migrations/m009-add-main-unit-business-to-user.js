'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'main_unit_business_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'main_unit_business_id');
  },
};
