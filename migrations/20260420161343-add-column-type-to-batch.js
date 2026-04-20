'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'type', {

        type: Sequelize.ENUM('INCOMING', 'OUTGOING'),
        allowNull: false,
        defaultValue: 'OUTGOING'
      
    });



  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expedition_batches', 'type');


  }
};