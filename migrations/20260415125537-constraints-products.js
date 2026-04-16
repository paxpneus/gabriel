'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addIndex('products', ['id_system'], {
      unique: true,
      name: 'products_id_system_key',
      where: {
        id_system: {
          [Sequelize.Op.ne]: null,
        },
      },
    });

    await queryInterface.addIndex('products', ['ean'], {
      unique: true,
      name: 'products_ean_unique_not_null',
      where: {
        ean: {
          [Sequelize.Op.ne]: null,
        },
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('products', 'products_id_system_key');
    await queryInterface.removeIndex('products', 'products_ean_unique_not_null');
  },
};