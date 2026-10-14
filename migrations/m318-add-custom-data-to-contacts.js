'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.addColumn('contacts', 'custom_data', {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
      }, { transaction });

      // Contact criado junto com usuário (afiliado) não tem id no sistema externo.
      await queryInterface.changeColumn('contacts', 'id_system', {
        type: Sequelize.STRING(100),
        allowNull: true,
      }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('contacts', 'id_system', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
    await queryInterface.removeColumn('contacts', 'custom_data');
  },
};
