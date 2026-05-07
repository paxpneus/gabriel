'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // =========================
      // products
      // =========================
      await queryInterface.addColumn('products', 'type', {
          type: Sequelize.ENUM('UNIT', 'KIT'),
        allowNull: false,
        defaultValue: 'UNIT',
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
      // reverse order
     
      // drop enum type for mode (Postgres)
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_products_type";`,
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};