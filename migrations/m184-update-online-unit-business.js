'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkUpdate(
      'unit_businesses',
      {
        type: 'ONLINE',
      },
      {
        name: [
          'Shopee',
          'Loja Pax Meli',
          'Site Novo - www.paxpneus.com.br',
        ],
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkUpdate(
      'unit_businesses',
      {
        type: 'PHYSICAL',
      },
      {
        name: [
          'Shopee',
          'Loja Pax Meli',
          'Site Novo - www.paxpneus.com.br',
        ],
      },
    );
  },
};