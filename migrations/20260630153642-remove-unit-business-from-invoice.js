'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoices
        DROP COLUMN IF EXISTS unit_business_id;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'unit_business_id', {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: 'unit_businesses',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    await queryInterface.addConstraint('invoices', {
      fields: ['unit_business_id'],
      type: 'foreign key',
      name: 'invoices_unit_business_id_fkey',
      references: {
        table: 'unit_businesses',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
  },
};