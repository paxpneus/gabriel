"use strict";

// Produtos que só têm integration mapping da Bling (não têm Tecinco pra
// corrigir a classificação) ficaram presos no grupo fabricado só pela
// Bling ("PNEUS IMPORTADOS"). Remapeia pro grupo real "PNEUS", usando a
// correspondência de subgroup confirmada direto no banco: PNEUS não tem
// aro isolado acima de 21 (tudo cai em "ARO 22 ACIMA") nem os subgroups
// IMPORTADOS/NACIONAIS-MOTO/OUTROS/PNEU AGRICOLA (caem no catch-all
// "DIVERSOS").

const SUBGROUP_NAME_MAP = [
  { from: "ARO 13", to: "ARO 13" },
  { from: "ARO 14", to: "ARO 14" },
  { from: "ARO 15", to: "ARO 15" },
  { from: "ARO 16", to: "ARO 16" },
  { from: "ARO 17", to: "ARO 17" },
  { from: "ARO 18", to: "ARO 18" },
  { from: "ARO 19", to: "ARO 19" },
  { from: "ARO 20", to: "ARO 20" },
  { from: "ARO 21", to: "ARO 21" },
  { from: "ARO 22", to: "ARO 22 ACIMA" },
  { from: "ARO 22 ACIMA", to: "ARO 22 ACIMA" },
  { from: "ARO 23", to: "ARO 22 ACIMA" },
  { from: "CARGA/TRANSPORTE/CAMARA DE AR", to: "CARGA/TRANSPORTE/CAMARA DE AR" },
  { from: "IMPORTADOS", to: "DIVERSOS" },
  { from: "NACIONAIS/ MOTO", to: "DIVERSOS" },
  { from: "OUTROS", to: "DIVERSOS" },
  { from: "PNEU AGRICOLA", to: "DIVERSOS" },
];

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      for (const { from, to } of SUBGROUP_NAME_MAP) {
        await queryInterface.sequelize.query(
          `
          UPDATE products p
          SET subgroup_id = target_sg.id
          FROM subgroups sg
          JOIN groups g ON g.id = sg.group_id AND g.name = 'PNEUS IMPORTADOS'
          JOIN groups target_g ON target_g.name = 'PNEUS' AND target_g.type = 'PRODUCTS'
          JOIN subgroups target_sg ON target_sg.group_id = target_g.id AND target_sg.name = :to
          WHERE p.subgroup_id = sg.id
            AND sg.name = :from
            AND EXISTS (
              SELECT 1 FROM integration_mappings im JOIN integrations i ON i.id = im.integrations_id
              WHERE im.entity_type = 'PRODUCT' AND im.internal_id::uuid = p.id AND i.name = 'Bling'
            )
            AND NOT EXISTS (
              SELECT 1 FROM integration_mappings im JOIN integrations i ON i.id = im.integrations_id
              WHERE im.entity_type = 'PRODUCT' AND im.internal_id::uuid = p.id AND i.name = 'Tecinco'
            );
          `,
          { replacements: { from, to }, transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down() {
    // Não reversível — o subgroup_id anterior (em PNEUS IMPORTADOS) não
    // fica registrado em lugar nenhum antes do remapeamento.
  },
};
