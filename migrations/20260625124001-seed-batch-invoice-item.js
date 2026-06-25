'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Busca todos os batch_invoices com seus invoice_items e expedition_batch_items
      // O JOIN é feito por:
      //   expedition_batch_invoices -> invoice_items (via invoice_id)
      //   expedition_batch_items (via expedition_batch_id + product_id do invoice_item)
      const [rows] = await queryInterface.sequelize.query(
        `
        SELECT
          ebi.id                    AS expedition_batch_invoice_id,
          ebi.expedition_batch_id,
          ii.product_id,
          ii.quantity_expected,
          ii.quantity_received,
          ii.status                 AS invoice_item_status,
          eb_item.id                AS expedition_batch_item_id
        FROM expedition_batch_invoices ebi
        -- Pega os invoice_items da invoice vinculada a este batch_invoice
        INNER JOIN invoice_items ii
          ON ii.invoice_id = ebi.invoice_id
        -- Acha o expedition_batch_item do mesmo batch que tem o mesmo produto
        INNER JOIN expedition_batch_items eb_item
          ON eb_item.expedition_batch_id = ebi.expedition_batch_id
          AND eb_item.product_id = ii.product_id
        `,
        { transaction }
      );

      if (rows.length === 0) {
        console.log('Nenhum dado encontrado para popular batch_invoice_items. Pulando...');
        await transaction.commit();
        return;
      }

      const now = new Date();

      const records = rows.map((row) => ({
        id: Sequelize.literal('gen_random_uuid()'),
        expedition_batch_invoice_id: row.expedition_batch_invoice_id,
        expedition_batch_item_id: row.expedition_batch_item_id,
        quantity_expected: row.quantity_expected,
        quantity_received: row.quantity_received,
        // Se já foi totalmente recebido, marca como FINISHED
        status: row.quantity_received >= row.quantity_expected && row.quantity_expected > 0
          ? 'FINISHED'
          : 'PENDING',
        created_at: now,
        updated_at: now,
      }));

      // Insere em lotes de 500 para não sobrecarregar
      const chunkSize = 500;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);

        // Monta VALUES manualmente porque bulkInsert não suporta Sequelize.literal por item
        const values = chunk
          .map(
            (r) =>
              `(gen_random_uuid(), '${r.expedition_batch_invoice_id}', '${r.expedition_batch_item_id}', ${r.quantity_expected}, ${r.quantity_received}, '${r.status}', NOW(), NOW())`
          )
          .join(',\n');

        await queryInterface.sequelize.query(
          `
          INSERT INTO batch_invoice_items
            (id, expedition_batch_invoice_id, expedition_batch_item_id, quantity_expected, quantity_received, status, created_at, updated_at)
          VALUES ${values}
          ON CONFLICT (expedition_batch_invoice_id, expedition_batch_item_id) DO NOTHING
          `,
          { transaction }
        );

        console.log(`Inseridos ${Math.min(i + chunkSize, records.length)} / ${records.length} registros...`);
      }

      await transaction.commit();
      console.log(`Migration de população concluída. Total inserido: ${records.length} registros.`);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      `DELETE FROM batch_invoice_items`,
    );
  },
};