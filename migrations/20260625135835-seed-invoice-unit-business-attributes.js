'use strict';

const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Busca todas as invoices
      const invoices = await queryInterface.sequelize.query(
        `SELECT id, type, status, batch_generated, sender_cnpj, receiver_cnpj FROM invoices`,
        { type: Sequelize.QueryTypes.SELECT, transaction },
      );

      // Busca todas as unit_businesses com cnpj
      const unitBusinesses = await queryInterface.sequelize.query(
        `SELECT id, cnpj FROM unit_businesses WHERE cnpj IS NOT NULL`,
        { type: Sequelize.QueryTypes.SELECT, transaction },
      );

      // Monta mapa cnpj -> unit_business_id para lookup O(1)
      const cnpjToUnitBusiness = new Map();
      for (const ub of unitBusinesses) {
        cnpjToUnitBusiness.set(ub.cnpj, ub.id);
      }

      const attributesToInsert = [];
      // Controla duplicatas em memória: "invoiceId:unitBusinessId"
      const seen = new Set();

      const addAttribute = (invoiceId, unitBusinessId, type, status, batchGenerated) => {
        const key = `${invoiceId}:${unitBusinessId}`;
        if (seen.has(key)) return;
        seen.add(key);

        attributesToInsert.push({
          id: uuidv4(),
          invoice_id: invoiceId,
          unit_business_id: unitBusinessId,
          type,
          status,
          batch_generated: batchGenerated,
          created_at: new Date(),
          updated_at: new Date(),
        });
      };

      for (const invoice of invoices) {
        const { id, type, status, batch_generated, sender_cnpj, receiver_cnpj } = invoice;

        if (type === 'INCOMING') {
          // sender_cnpj: do ponto de vista dessa UB, ela está enviando → OUTGOING
          const senderUbId = cnpjToUnitBusiness.get(sender_cnpj);
          if (senderUbId) {
            addAttribute(id, senderUbId, 'OUTGOING', 'OPEN', false);
          }

          // receiver_cnpj: do ponto de vista dessa UB, ela está recebendo → INCOMING
          const receiverUbId = cnpjToUnitBusiness.get(receiver_cnpj);
          if (receiverUbId) {
            addAttribute(id, receiverUbId, 'INCOMING', status, batch_generated);
          }
        } else if (type === 'OUTGOING') {
          // receiver_cnpj: do ponto de vista dessa UB, ela está recebendo → INCOMING
          const receiverUbId = cnpjToUnitBusiness.get(receiver_cnpj);
          if (receiverUbId) {
            addAttribute(id, receiverUbId, 'INCOMING', 'OPEN', false);
          }

          // sender_cnpj: do ponto de vista dessa UB, ela está enviando → OUTGOING
          const senderUbId = cnpjToUnitBusiness.get(sender_cnpj);
          if (senderUbId) {
            addAttribute(id, senderUbId, 'OUTGOING', status, batch_generated);
          }
        }
      }

      if (attributesToInsert.length > 0) {
        // Insere em lotes de 500 para não sobrecarregar o banco
        const chunkSize = 500;
        for (let i = 0; i < attributesToInsert.length; i += chunkSize) {
          const chunk = attributesToInsert.slice(i, i + chunkSize);
          await queryInterface.bulkInsert('invoice_unit_business_attributes', chunk, { transaction });
        }
      }

      await transaction.commit();

      console.log(`✅ Seed concluída: ${attributesToInsert.length} invoice_unit_business_attributes criados.`);
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Erro na seed, rollback realizado:', error);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('invoice_unit_business_attributes', null, {});
  },
};