'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {


      await queryInterface.addColumn('expedition_batches', 'mode', {
        type: Sequelize.ENUM('REGULAR', 'ADVANCED'),
        allowNull: false,
        defaultValue: 'REGULAR',
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.removeColumn('expedition_batches', 'mode', { transaction });
      

      // drop enum type for mode (Postgres)
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_expedition_batches_mode";`,
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};