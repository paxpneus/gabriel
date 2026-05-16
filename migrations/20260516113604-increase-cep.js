'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('carrier_label_ranges', 'cep_start', {
      type: Sequelize.STRING(15),
            allowNull: false,
    });

    await queryInterface.changeColumn('carrier_label_ranges', 'cep_end', {
      type: Sequelize.STRING(15),
            allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('carrier_label_ranges', 'cep_start', {
      type: Sequelize.STRING(15),
            allowNull: false,
    });

    await queryInterface.changeColumn('carrier_label_ranges', 'cep_end', {
     type: Sequelize.STRING(15),
            allowNull: false,
    });
  },
};