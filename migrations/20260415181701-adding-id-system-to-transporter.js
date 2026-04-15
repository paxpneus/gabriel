'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('transporters', 'id_system', {
      type: Sequelize.STRING(100),
      allowNull: true,
    
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('transporters', 'id_system');
    

  }
};