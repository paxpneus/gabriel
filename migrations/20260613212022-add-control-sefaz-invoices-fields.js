'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'sefaz_full_xml_attempts', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('invoices', 'sefaz_full_xml_last_query_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.changeColumn('invoices', 'sefaz_manifestation_status', {
      type: Sequelize.ENUM(
        'PENDING_CIENCIA',
        'CIENCIA_ENVIADA',
        'CIENCIA_REJEITADA',
        'CONFIRMADO',
        'DESCONHECIDO',
        'OPERACAO_NAO_REALIZADA',
        'AGUARDANDO_PROCNFE',
        'PROCNFE_DESISTIDO',
      ),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'sefaz_full_xml_attempts');
    await queryInterface.removeColumn('invoices', 'sefaz_full_xml_last_query_at');

    await queryInterface.changeColumn('invoices', 'sefaz_manifestation_status', {
      type: Sequelize.ENUM(
        'PENDING_CIENCIA',
        'CIENCIA_ENVIADA',
        'CIENCIA_REJEITADA',
        'CONFIRMADO',
        'DESCONHECIDO',
        'OPERACAO_NAO_REALIZADA',
      ),
      allowNull: true,
      defaultValue: null,
    });
  },
};