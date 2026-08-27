'use strict';

// Limpa integration_mappings duplicados/órfãos causados por dois bugs de
// código já corrigidos em product.helpers.ts / integration-mapping.service.ts:
//
// 1) createOrUpdateIntegrationMapping fazia o "find" por
//    (entity_type, integrations_id, internal_id, external_id) juntos — quando
//    a Tecinco reatribuía o epctb_codigo de um produto (external_id novo), o
//    find nunca achava o mapping antigo e criava um segundo, em vez de
//    reapontar. Aqui mantemos o mapping mais antigo por
//    (entity_type, integrations_id, internal_id) e apagamos os demais, só
//    para os 25 produtos identificados manualmente (ver PR/conversa).
//
// 2) normalizeEan não reconhecia "SEMGTIN" (sem espaço) como "sem EAN" —
//    tratava como um EAN de verdade, fazendo vários produtos sem código de
//    barras se resolverem para o MESMO Product (o que tinha ean="SEMGTIN"
//    literal). Esse é o produto com 23 mappings na lista abaixo.
//
// 3) integration_mappings não tem FK/cascade para products — deletar um
//    produto (ex.: migrations m251/m252/m253) não limpa os mappings dele,
//    deixando linhas órfãs (internal_id que não existe mais). Isso é limpado
//    de forma genérica para toda a tabela, não só para os 25 produtos acima.

const DUPLICATE_PRODUCT_IDS = [
  'de9b95e8-c374-429e-b3ce-548952764045', // PNEU 31X10,5R15 CONTI CROSS CONTACT (23 mappings, EAN=SEMGTIN)
  '2de29a75-b10f-4f99-a36d-41ca79d2a4cd', // Kit 2 Pneus 205/60r15 ContiPremiumContact 2 91v
  '456e1a64-2aa2-4ffd-bb49-24c207200c4f', // Pneu 165/70R13 Altimax One
  'd9b7d41c-3008-411b-a142-8f862bcf3d66', // Pneu 185/70R14 ContiPowerContact
  '6a8fb040-2000-477d-a809-373b6f3a0b75', // Pneu 195/60R15 Altimax One
  '1edca6f0-06ae-4c93-aa4a-245850bd5c62', // PNEU 195/65R16C DELINTE DV2
  '0a90da4a-6e31-4e6c-a08f-2d2f9c0ba8ee', // Pneu 195/70R15C VanContact Ultra (duplicado em Tecinco E Bling)
  '4342448a-fb6e-47bf-9c26-510cfea650b2', // Pneu 205/50R17 ContiPremiumContact 2 SSR RunFlat
  '48385cd9-43ab-42fe-93b9-75e5ef51cdc1', // Pneu 205/55R16 EVERTREK HP
  'b69f0e22-0266-4493-aa9e-2d9ac3fdc0e5', // Pneu 205/55R16 ExtremeContact DW
  '46ffa6d9-56a5-43f9-b877-09d92581d202', // Pneu 205/55R17 ContiPowerContact
  'd3bdd242-392c-4432-864f-10c7a1b307aa', // Pneu 215/75R16C VanContact Ultra
  '09a23e72-6cc5-4bcb-9389-7c3b9c7cf62e', // Pneu 225/45R17 ContiSportContact 5 SSR
  '32aae7e2-3d88-4ef6-9754-f124428f3380', // PNEU 225/60R17 BRIDGESTONE TURANZA T005
  '1431889d-de2d-4f52-a725-c4f90247551c', // Pneu 235/45R18 ContiSportContact 5 Contiseal
  'cc5444c8-fdd0-4166-930d-a8929495196c', // Pneu 235/50R19 EcoContact 6
  'e9ca9597-2350-4a94-abaf-6ea95b0c94e4', // Pneu 245/40R17 ContiSportContact 5 MO
  '33a96fee-fe0a-451e-b039-86d281f8692c', // Pneu 245/65R17 Grabber AT3
  '64007d2e-e65b-4ecf-bbbf-dc9190dc4df5', // Pneu 255/30R19 ContiSportContact 5P RO2
  '3c5e7f2c-7816-4454-93a1-3a8f1558b82f', // Pneu 255/45R20 EcoContact 6Q
  '2aa24311-2475-4483-a8f5-c735b6cb411b', // Pneu 265/45R20 ContiSportContact 5 SUV MO
  '7c94daea-172c-4462-b5b8-f2d17a225a66', // Pneu 265/70R16 ContiCrossContact LX2
  'f89b5aa0-7900-42ea-8b67-ea2d538b1fef', // PNEU 265/75R16 AEOLUS AT AS01
  '5f3c461e-7b3e-4f38-9a5a-c478db581e70', // PNEU 275/40R20 DELINTE DS2
  'e4875fce-2b32-4751-94e0-16155db39f1c', // Pneu 275/40R21 Speedmax DSU02
];

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // ─── 1) Duplicados nos 25 produtos identificados: mantém o mais antigo
      //        por (entity_type, integrations_id, internal_id) ────────────────
      const [deletedDuplicates] = await queryInterface.sequelize.query(
        `
        DELETE FROM integration_mappings im
        WHERE im.internal_id IN (:ids)
          AND im.id NOT IN (
            SELECT DISTINCT ON (entity_type, integrations_id, internal_id) id
            FROM integration_mappings
            WHERE internal_id IN (:ids)
            ORDER BY entity_type, integrations_id, internal_id, created_at ASC
          )
        RETURNING im.id;
        `,
        { replacements: { ids: DUPLICATE_PRODUCT_IDS }, transaction },
      );
      console.log(
        `[m254] integration_mappings duplicados removidos (25 produtos): ${deletedDuplicates.length}`,
      );

      // ─── 2) Mappings de PRODUCT órfãos (internal_id não existe mais em
      //        products) — em toda a tabela, não só os 25 acima ────────────────
      const [deletedOrphans] = await queryInterface.sequelize.query(
        `
        DELETE FROM integration_mappings im
        WHERE im.entity_type = 'PRODUCT'
          AND NOT EXISTS (
            SELECT 1 FROM products p WHERE p.id = im.internal_id::uuid
          )
        RETURNING im.id;
        `,
        { transaction },
      );
      console.log(
        `[m254] integration_mappings órfãos removidos (produto não existe mais): ${deletedOrphans.length}`,
      );

      // ─── 3) Zera (não apaga) o stock dos 25 produtos em toda unit business
      //        exceto a Bling (361b5640-...) — os mappings duplicados fizeram
      //        esses produtos serem sincronizados com dado de estoque errado.
      //        Não apaga a linha porque inventory_batch_items referencia
      //        stock_id com ON DELETE RESTRICT (batches de conferência já
      //        corrigidos anteriormente para alguns desses produtos).
      const BLING_UNIT_BUSINESS_ID = '361b5640-ec04-4b3f-8191-fe3ac5f134c4';
      const [zeroedStocks] = await queryInterface.sequelize.query(
        `
        UPDATE stocks
        SET quantity = 0, total_price = 0, updated_at = now()
        WHERE product_id IN (:ids)
          AND unit_business_id IS DISTINCT FROM :blingUnitBusinessId
          AND (quantity <> 0 OR total_price <> 0)
        RETURNING id;
        `,
        {
          replacements: {
            ids: DUPLICATE_PRODUCT_IDS,
            blingUnitBusinessId: BLING_UNIT_BUSINESS_ID,
          },
          transaction,
        },
      );
      console.log(
        `[m254] stocks zerados (25 produtos, fora da unit business Bling): ${zeroedStocks.length}`,
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Não reversível: não há como reconstruir os mappings duplicados/órfãos
  // removidos (nem seria desejável — eram dados errados).
  async down() {
    console.log('[m254] down() não implementado — remoção de dados não reversível.');
  },
};
