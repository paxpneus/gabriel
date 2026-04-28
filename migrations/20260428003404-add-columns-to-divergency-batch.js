'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('inventory_batches', 'type', {
      type: Sequelize.ENUM('REGULAR', 'DIVERGENCY'),
      defaultValue: 'REGULAR',
      allowNull: false,
    });

    await queryInterface.addColumn('inventory_batches', 'batch_id_for_divergency', {
      type: Sequelize.UUID,
      allowNull: true, 
      references: {
        model: 'inventory_batches',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('inventory_batches', 'batch_id_for_divergency');

    await queryInterface.removeColumn('inventory_batches', 'type');

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_inventory_batches_type";'
    );
  },
};