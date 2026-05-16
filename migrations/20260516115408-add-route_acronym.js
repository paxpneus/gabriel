'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
    
      await queryInterface.addColumn('carrier_import_layouts', 'route_acronym', {
        type: Sequelize.STRING(100),
        allowNull: true,
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
      await queryInterface.removeColumn('carrier_import_layouts', 'route_acronym', { transaction });


      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};