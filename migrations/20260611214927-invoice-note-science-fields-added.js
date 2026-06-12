"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      // 1. Cria o ENUM antes de usar na coluna
      await queryInterface.sequelize.query(
        `CREATE TYPE "enum_invoices_sefaz_manifestation_status" AS ENUM (
          'PENDING_CIENCIA',
          'CIENCIA_ENVIADA',
          'CIENCIA_REJEITADA',
          'CONFIRMADO',
          'DESCONHECIDO',
          'OPERACAO_NAO_REALIZADA'
        )`,
        { transaction: t },
      );

      // 2. Status da manifestação — rastreia o ciclo completo de manifestação
      //    NULL = nota não veio da distribuição DFe (entrada manual/Bling)
      //    PENDING_CIENCIA    = resNFe recebido, ciência ainda não enviada
      //    CIENCIA_ENVIADA    = ciência enviada com sucesso (cStat 135)
      //    CIENCIA_REJEITADA  = SEFAZ rejeitou a ciência (cStat != 135)
      //    CONFIRMADO         = Confirmação da Operação enviada
      //    DESCONHECIDO       = Desconhecimento da Operação enviada
      //    OPERACAO_NAO_REALIZADA = Operação Não Realizada enviada
      await queryInterface.addColumn(
        "invoices",
        "sefaz_manifestation_status",
        {
          type: Sequelize.ENUM(
            "PENDING_CIENCIA",
            "CIENCIA_ENVIADA",
            "CIENCIA_REJEITADA",
            "CONFIRMADO",
            "DESCONHECIDO",
            "OPERACAO_NAO_REALIZADA",
          ),
          allowNull: true,
          defaultValue: null,
          comment:
            "Ciclo de Manifestação do Destinatário. NULL = não originada da distribuição DFe.",
        },
        { transaction: t },
      );

      // 3. nSeqEvento — próximo número de sequência a usar na SEFAZ.
      //    Incrementado a cada evento enviado com sucesso para esta chave.
      //    Começa em 1. SEFAZ rejeita (cStat=573) se reenviar o mesmo nSeq.
      await queryInterface.addColumn(
        "invoices",
        "sefaz_n_seq_evento",
        {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 1,
          comment:
            "Próximo nSeqEvento a usar na SEFAZ. Incrementado após cada evento aceito (cStat=135).",
        },
        { transaction: t },
      );

      // 4. NSU do documento que originou esta invoice na distribuição DFe
      await queryInterface.addColumn(
        "invoices",
        "sefaz_nsu",
        {
          type: Sequelize.STRING(15),
          allowNull: true,
          defaultValue: null,
          comment: "NSU do resNFe/procNFe que originou este registro.",
        },
        { transaction: t },
      );

      // 5. Índice para buscas por chave de acesso (já existe xml_key, mas
      //    adicionamos índice explícito se ainda não houver)
      // Obs: xml_key já tem unique: true no model — o índice já existe.
      // Adicionamos um índice no sefaz_manifestation_status para queries
      // de monitoramento e reprocessamento.
      await queryInterface.addIndex(
        "invoices",
        ["sefaz_manifestation_status"],
        {
          name: "invoices_sefaz_manifestation_status_idx",
          where: { sefaz_manifestation_status: { [Sequelize.Op.ne]: null } },
          transaction: t,
        },
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (t) => {
      await queryInterface.removeIndex(
        "invoices",
        "invoices_sefaz_manifestation_status_idx",
        { transaction: t },
      );
      await queryInterface.removeColumn("invoices", "sefaz_nsu", {
        transaction: t,
      });
      await queryInterface.removeColumn("invoices", "sefaz_n_seq_evento", {
        transaction: t,
      });
      await queryInterface.removeColumn(
        "invoices",
        "sefaz_manifestation_status",
        { transaction: t },
      );
      await queryInterface.sequelize.query(
        `DROP TYPE IF EXISTS "enum_invoices_sefaz_manifestation_status"`,
        { transaction: t },
      );
    });
  },
};