'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addConstraint('stocks', {
      fields: ['product_id'],
      type: 'unique',
      name: 'stocks_product_id_unique',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('stocks', 'stocks_product_id_unique');
  }
};