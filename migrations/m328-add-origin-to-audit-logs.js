'use strict';

// origin: quem gerou o log — USER (usuário logado), SYSTEM (sync/fila automática), PDV (link do PDV, sem login).
// STRING com enum só no TS, igual entity/action; linhas antigas vêm todas de fluxo manual → USER.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('audit_logs', 'origin', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'USER',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('audit_logs', 'origin');
  },
};
