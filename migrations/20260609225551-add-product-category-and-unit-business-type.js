'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'category', {
      type: Sequelize.ENUM(
        'TIRE',
        'PART',
        'OIL',
        'BATTERY',
        'ACCESSORY',
        'WHEEL',
        'TUBE',
        'SERVICE',
        'OTHER',
      ),
      allowNull: true,
      defaultValue: 'TIRE',
    });

    await queryInterface.addColumn('unit_businesses', 'type', {
      type: Sequelize.ENUM('PHYSICAL', 'ONLINE'),
      allowNull: false,
      defaultValue: 'PHYSICAL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'category');
    await queryInterface.removeColumn('unit_businesses', 'type');

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_products_category";',
    );

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_unit_businesses_type";',
    );
  },
};