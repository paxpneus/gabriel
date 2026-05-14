'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      
      await queryInterface.addColumn('user_config', 'visualize_only_current_unit_business', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      await queryInterface.removeColumn('user_config', 'visualize_only_current_unit_business', { transaction });


      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
