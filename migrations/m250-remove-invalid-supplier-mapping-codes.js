"use strict";

// Limpeza de lixo legado em product_supplier_maps, identificado ao investigar
// duplicatas de supplier_product_code após a correção do fluxo de sync da
// Tecinco (ver m249). Dois grupos de linhas são removidos:
//
// 1) Linhas específicas (por id) escolhidas manualmente entre pares de
//    produtos duplicados com o mesmo supplier_product_code — mantendo o
//    produto "correto" e removendo o registro redundante/mal vinculado:
//    - "0000" e "000000003584380000" são códigos placeholder (não é um EAN
//      real), então todas as linhas desses dois grupos são removidas.
//    - Para os pares reais (mesmo pneu cadastrado duas vezes em produtos
//      diferentes), remove-se apenas uma linha de cada par, mantendo a outra.
//
// 2) Qualquer linha com supplier_product_code nulo ou igual a "0" (também
//    placeholder, não é um EAN/código de fornecedor válido).

const IDS_TO_REMOVE = [
  // supplier_product_code = "0000" (placeholder) — todas as 3 linhas
  "0e8038ed-da05-4d63-9fb7-fed28fe80334", // id_system=16651090471
  "5092663d-6be8-49e6-b9fc-8e39ae8a955a", // id_system=16641587224
  "45aeedd4-7112-4902-bc27-7c2af4a2c74b", // id_system=16651094624

  // supplier_product_code = "000000000010022925" — remove só o duplicado indicado
  "51f83f13-4859-42b2-9533-f17c15b34509", // id_system=16612959409

  // supplier_product_code = "000000003584380000" (placeholder) — todas as 3 linhas
  "b6fc6e31-fed8-4161-9daa-38f2bae29a70", // id_system=16210554792
  "35a2941d-9eda-492d-bdfe-1a7880015d79", // id_system=16210555685
  "20e3e436-4006-4864-8e80-93aae124cf53", // id_system=16515305648

  // pares reais duplicados — remove só o duplicado indicado, mantém o outro
  "85cb93e1-d0eb-4a82-b18c-a241a9d1976b", // 4019238089349 | id_system=22366
  "949f854c-948c-4ed7-91ce-4a0ce0d90a6b", // 4019238098419 | id_system=16525939424
  "c9e46b8f-e8f7-44a4-bc6f-5b76e0d4990d", // 4019238296471 | id_system=20311
  "281b1371-7181-45a9-9d1b-6e91c74a7568", // 4019238995374 | id_system=9162
  "7c68bb76-48d3-405f-932d-811a5d6e0330", // 6972743365651 | id_system=15071
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        DELETE FROM product_supplier_maps
        WHERE id IN (:ids)
           OR supplier_product_code IS NULL
           OR trim(supplier_product_code) = '0';
        `,
        {
          replacements: { ids: IDS_TO_REMOVE },
          transaction,
        },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    // Não reversível — as linhas removidas eram lixo/placeholder e não há
    // como reconstruir os dados originais aqui.
  },
};
