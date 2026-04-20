'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_scan_logs', 'expedition_batch_id', {

        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'expedition_batches',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      
    });



  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expedition_scan_logs', 'expedition_batch_id');


  }
};