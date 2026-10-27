'use strict';

// custom_data: JSONB genérico do contato (PUT faz merge); id_system opcional pra contatos criados via /with-user.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'contacts',
        'custom_data',
        { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
        { transaction },
      );
      await queryInterface.changeColumn(
        'contacts',
        'id_system',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction },
      );
    });
  },

  // Volta id_system pra NOT NULL: falha se já houver contato sem id_system.
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.changeColumn(
        'contacts',
        'id_system',
        { type: Sequelize.STRING(100), allowNull: false },
        { transaction },
      );
      await queryInterface.removeColumn('contacts', 'custom_data', { transaction });
    });
  },
};
