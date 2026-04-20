'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'total_volumes_received', {

      type: Sequelize.INTEGER,
      defaultValue: 0,

    });



  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expedition_batches', 'total_volumes_received');


  }
};