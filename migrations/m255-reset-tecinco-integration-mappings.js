'use strict';

// Apaga TODOS os integration_mappings da integração Tecinco (PRODUCT + CONTACT).
//
// Motivo: mesmo depois da m254 limpar os duplicados/órfãos, alguns mappings
// que sobraram já estavam apontando para o produto ERRADO desde a origem
// (não é duplicata — é um único mapping resolvido incorretamente, provável
// efeito colateral do bug do "SEMGTIN" e de resoluções cruzadas por EAN
// antes dos fixes em product.helpers.ts/integration-mapping.service.ts).
// Não dá para saber qual mapping individual está errado sem recomputar a
// resolução do zero.
//
// Estratégia: zera geral e deixa o populate-from-tecinco (ou
// populate-from-tecinco-choose) recriar tudo do zero, já com o código
// corrigido — resolveProductWithMapping vai re-resolver cada produto pelos
// fallbacks (EAN/codigoFabrica/SupplierMapping) sem o bug do SEMGTIN e sem
// duplicar quando o epctb_codigo mudar de novo no futuro.

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const [deleted] = await queryInterface.sequelize.query(
        `
        DELETE FROM integration_mappings im
        USING integrations i
        WHERE im.integrations_id = i.id
          AND i.name = 'Tecinco'
        RETURNING im.id, im.entity_type;
        `,
        { transaction },
      );

      const byType = deleted.reduce((acc, row) => {
        acc[row.entity_type] = (acc[row.entity_type] ?? 0) + 1;
        return acc;
      }, {});

      console.log(
        `[m255] integration_mappings da Tecinco removidos: ${deleted.length} (${JSON.stringify(byType)})`,
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Não reversível: os mappings precisam ser recriados rodando
  // populate-from-tecinco / populate-from-tecinco-choose depois desta migration.
  async down() {
    console.log(
      '[m255] down() não implementado — rode populate-from-tecinco para recriar os mappings.',
    );
  },
};
