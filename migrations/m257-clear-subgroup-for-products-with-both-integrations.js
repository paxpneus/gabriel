"use strict";

// Produtos que têm integration mapping tanto da Tecinco quanto da Bling
// (o mesmo produto físico chegou via as duas integrações) tinham seu
// subgroup_id sobrescrito pela Bling a cada sync, mesmo quando a Tecinco
// já classificou o produto corretamente no grupo real (PNEUS). Zera esses
// casos — a próxima sync da Tecinco reescreve o subgroup_id certo, já que
// ela sempre sobrescreve.

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        UPDATE products p
        SET subgroup_id = NULL
        WHERE EXISTS (
            SELECT 1 FROM integration_mappings im
            JOIN integrations i ON i.id = im.integrations_id
            WHERE im.entity_type = 'PRODUCT' AND im.internal_id::uuid = p.id AND i.name = 'Tecinco'
          )
          AND EXISTS (
            SELECT 1 FROM integration_mappings im
            JOIN integrations i ON i.id = im.integrations_id
            WHERE im.entity_type = 'PRODUCT' AND im.internal_id::uuid = p.id AND i.name = 'Bling'
          );
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down() {
    // Não reversível — o subgroup_id anterior não fica registrado em
    // lugar nenhum antes do zeramento.
  },
};
