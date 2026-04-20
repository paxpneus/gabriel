'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expedition_batches', 'transporters_id', {

        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'transporters',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
    });



  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expedition_batches', 'transporters_id');


  }
};