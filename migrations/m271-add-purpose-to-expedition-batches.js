'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'purpose', {
      type: Sequelize.ENUM('REGULAR', 'TRANSSHIPMENT'),
      allowNull: false,
      defaultValue: 'REGULAR',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('expedition_batches', 'purpose');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_expedition_batches_purpose";');
  },
};
