"use strict";

// Trata os produtos que sobraram sem grupo (subgroup_id nulo) depois da
// m251/m252 — classificação feita manualmente pelo usuário revisando a
// lista dos 49 produtos.
//
// 1) EXCLUI 15 linhas que não são produto de verdade (estorno de ICMS,
//    material de embalagem/escritório, aditivo Liqui Moly avulso, etc.).
//    Algumas têm nota fiscal/lote de expedição vinculados (FK RESTRICT),
//    então o histórico é apagado junto, igual na m252.
//
// 2) REALOCA os 34 produtos restantes (todos pneus de verdade) para o
//    subgroup correto dentro do grupo PNEUS, com base no aro extraído do
//    nome (ex.: "255/40R18" → ARO 18, "31X10.50R15" → ARO 15). O tamanho
//    285/40ZR23 (aro 23) não tem subgroup específico, então cai em
//    "ARO 22 ACIMA".

const IDS_TO_DELETE = [
  "d156e975-ce57-4cce-9066-9c0676d17055", // ESTORNO DE ICMS (16641633073)
  "3e84adad-dcc5-43ac-bac5-c3642ace0481", // ESTORNO DE ICMS (16656708883)
  "8f7fa106-e06f-473e-afee-8c572712872a", // ESTORNO DE CREDITO DE ICMS
  "1ee83285-8319-4a9d-8cf0-5fbc218533c4", // STRETCH CORTADO 3" GOLD 166MM X 0,023
  "06cc7006-9190-42ef-9fa3-e422912a4e82", // STRECH MANUAL 50X25 O4608
  "11ddac84-d78e-4233-bc8e-3efe0fc06fcc", // CABO REDE RJ45 15 M CAT 5
  "ab1f86ff-2394-40e6-b0ad-d60a1dffd32f", // CHAPA PLASTIF 1100 X 2200 X 20 MM
  "a51bc15a-3ad4-41b6-a755-b125daa077bc", // Liqui Moly Oil Additiv 150ml
  "ffc0b83d-4b9b-4373-a2d6-dd0e8fcafeb2", // Liqui Moly Cera Tec 300ml
  "6164ec83-8151-43cf-b8ca-f5c004d2151f", // Liqui Moly Catalytic-System Cleaner 300ml
  "9ad27e18-2125-4317-b4f1-5e98898f19c3", // Liqui Moly Oil Additiv 300ml
  "ee21d795-9fee-4be5-95d7-8c46c1eb74e3", // Liqui Moly Catalytic-System Clean 300ml
  "9a343f82-7d18-4cd1-8ceb-19fa3fe44bf9", // COXIM FRONTAL DO MOTOR CORSA MB-1198
  "f2b316ed-f6bb-4583-8694-34cf65966ab7", // Liqui Moly Gasoline Engine System Cleaner 300ml
  "56f1c792-d6a3-41d2-8280-46f42090499b", // VALVULA TORRE AR CONDICIONADO
];

const REGROUP = [
  // ARO 14
  { id: "918cfe3a-7573-43be-91e6-85afcfac8168", subgroup: "ARO 14" }, // Kit 2 Pneus 185r14c Eurovan 2
  { id: "6d489c3b-3eb8-44b4-86ea-d4432678b56d", subgroup: "ARO 14" }, // Kit 2 Pneus 195r14 ContiVanContact
  { id: "c5ffc04d-e8b9-4494-9f7f-3946f2a53007", subgroup: "ARO 14" }, // Kit 4 Pneus 185r14c Eurovan 2
  { id: "20f604cc-6676-4844-89bd-3b009f05c69b", subgroup: "ARO 14" }, // Kit 4 Pneus 195r14 ContiVanContact
  { id: "e7a6bfc2-bc15-4fd7-aed1-6b0391ce80cb", subgroup: "ARO 14" }, // Pneu 185R14C Eurovan 2 GT
  { id: "996199be-17ed-4583-812c-6e6afffc8047", subgroup: "ARO 14" }, // Pneu 185R14C CV5000 Firestone
  { id: "ab82d20c-cb49-44e0-b782-63b5f8cb0620", subgroup: "ARO 14" }, // Pneu 195R14C ContiVanContact 100

  // ARO 15
  { id: "f93247ae-cf5e-4832-a020-b4e27faf703f", subgroup: "ARO 15" }, // Kit 2 Pneu 31x10.50r15 MT23
  { id: "1f46b4c0-5857-437a-ab02-73e44e6e4bc9", subgroup: "ARO 15" }, // Kit 2 Pneus 31x10.50r15 Pangea AT
  { id: "fd48ce1b-8cf1-4d65-813f-9c35bddb44e3", subgroup: "ARO 15" }, // Kit 2 pneus Speedmax SPM101
  { id: "3cb62804-f96d-4e52-b837-bc7e9ac8357b", subgroup: "ARO 15" }, // Kit 4 Pneus 31x10.50r15 Pangea AT
  { id: "b3b3750e-3c8e-44bb-b2b5-42e03aed5ff4", subgroup: "ARO 15" }, // Pneu 31X10.50R15 Speedmax Pangea
  { id: "57f99500-61b3-4b2f-95f0-50d341d0bda7", subgroup: "ARO 15" }, // Pneu 31X10.50R15 Speedmax SPM101
  { id: "ae3248fe-6955-4ca3-a8d1-ca1df3052077", subgroup: "ARO 15" }, // Pneu 31X10.50R15 LT MT23 Firestone
  { id: "4ebf8e53-84d3-41d6-a6fe-3b190b0cd30d", subgroup: "ARO 15" }, // Pneu 31X10.50R15LT Laufenn

  // ARO 16
  { id: "fa059cf1-7fdd-4179-b5bf-8fc62b88bd71", subgroup: "ARO 16" }, // Kit 2 Pneus LT265/75r16 ATX Firestone
  { id: "0e18c0f3-8c6c-4c1d-8a18-4afb0cda267d", subgroup: "ARO 16" }, // Pneu 225/65R16C Eurovan 2
  { id: "9e210a32-032b-434a-97c7-707702c67c8d", subgroup: "ARO 16" }, // Pneu LT265/75R16 112Q MT23 Firestone
  { id: "8103cbc0-3460-424b-88a2-2add5d4281dc", subgroup: "ARO 16" }, // Pneu LT265/75R16 123S ATX Firestone

  // ARO 17
  { id: "c057ab10-9f9d-4729-b7fc-cc417fb17b44", subgroup: "ARO 17" }, // Kit 2 Pneus Barum 205/40 R17
  { id: "2623f2c8-fd56-4ee5-a275-bdaecc2a8920", subgroup: "ARO 17" }, // Kit 4 Pneus Barum 205/40 R17
  { id: "206f1b03-b227-4ac4-9b18-66e327584ff6", subgroup: "ARO 17" }, // Pneu 235/55R17 CrossContact UHP

  // ARO 18
  { id: "6afca281-a647-4c06-8301-2a826908409e", subgroup: "ARO 18" }, // ALENZA 001 EXT 235/55R18
  { id: "894829e9-ab78-461a-95cd-3f496a6a09a1", subgroup: "ARO 18" }, // Pneu 255/40R18 ContiSportContact 5 SSR
  { id: "d67a7df8-41a0-4370-a017-6f98d9f0e38f", subgroup: "ARO 18" }, // Pneu 255/40R18 ContiSportContact 3 MO
  { id: "c299c4e8-dbe5-41d0-b607-7da5903c4f4c", subgroup: "ARO 18" }, // Pneu 265/35R18 ContiSportContact 3 MO
  { id: "ccb62ff3-44c9-4187-9832-56acc5557097", subgroup: "ARO 18" }, // Pneu 33X12.50R18 Speedmax Pangea
  { id: "040bbc68-ef50-48ed-b5ec-65c3cd72b4bd", subgroup: "ARO 18" }, // Pneu 35X12.50R18 Pangea All-Terrain
  { id: "60420afb-3ffe-4216-8124-c08069c930cd", subgroup: "ARO 18" }, // Pneu 35x12.5R18 Grabber A/TX
  { id: "4efb3a94-d098-464f-8d09-dcc6882949cf", subgroup: "ARO 18" }, // TRNZ ER33 225/60R18

  // ARO 19
  { id: "a4eb4ac1-d098-4166-8ae9-75bed95d1e13", subgroup: "ARO 19" }, // ALENZA 001 235/55R19
  { id: "6b593ca5-8828-4b03-b888-624f1e202802", subgroup: "ARO 19" }, // Pneu 245/45R19 ContiSportContact 3 SSR

  // ARO 20
  { id: "9d59b6db-2aa3-443d-b139-8beb68da6278", subgroup: "ARO 20" }, // Pneu 35X12.50R20 Pangea RT Speedmax

  // ARO 22 ACIMA (285/40ZR23 não tem subgroup próprio de aro 23)
  { id: "887fadf6-891c-4573-8db2-c884ca70f57b", subgroup: "ARO 22 ACIMA" }, // Pneu 285/40ZR23 SC7
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `DELETE FROM stock_movements WHERE product_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM invoice_items WHERE product_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM expedition_batch_items WHERE product_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM inventory_batch_items WHERE product_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM operations_itens WHERE product_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM kit_components WHERE product_component_id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );
      await queryInterface.sequelize.query(
        `DELETE FROM products WHERE id IN (:ids);`,
        { replacements: { ids: IDS_TO_DELETE }, transaction },
      );

      for (const { id, subgroup } of REGROUP) {
        await queryInterface.sequelize.query(
          `
          UPDATE products
          SET subgroup_id = (
            SELECT sg.id FROM subgroups sg
            JOIN groups g ON g.id = sg.group_id
            WHERE g.name = 'PNEUS' AND sg.name = :subgroup
          )
          WHERE id = :id;
          `,
          { replacements: { id, subgroup }, transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    // Não reversível — produtos apagados não podem ser reconstruídos, e o
    // subgroup_id anterior (nulo) não precisa ser desfeito.
  },
};
