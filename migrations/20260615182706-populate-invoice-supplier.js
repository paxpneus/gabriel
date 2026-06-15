'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { QueryTypes } = Sequelize;

    // Busca todas as invoices que possuem source_payload com fornecedor.id
    // e ainda não têm supplier_id preenchido
    const invoices = await queryInterface.sequelize.query(
      `
      SELECT id, source_payload
      FROM invoices
      WHERE source_payload -> 'fornecedor' ->> 'id' IS NOT NULL
        AND supplier_id IS NULL
      `,
      { type: QueryTypes.SELECT },
    );

    console.log(`[populate-invoice-supplier-id] ${invoices.length} invoices a processar.`);

    // Cache em memória para evitar buscar/criar o mesmo fornecedor várias vezes
    const supplierCache = new Map(); // key: id_system (fornecedor.id como string) -> supplier id (uuid)

    for (const invoice of invoices) {
      const payload =
        typeof invoice.source_payload === 'string'
          ? JSON.parse(invoice.source_payload)
          : invoice.source_payload;

      const fornecedor = payload?.fornecedor;
      const contato = payload?.contato;

      if (!fornecedor?.id) continue;

      const idSystem = String(fornecedor.id);

      let supplierId = supplierCache.get(idSystem);

      if (!supplierId) {
        // 1. Verifica se já existe supplier com esse id_system
        const existing = await queryInterface.sequelize.query(
          `SELECT id FROM suppliers WHERE id_system = :idSystem LIMIT 1`,
          {
            replacements: { idSystem },
            type: QueryTypes.SELECT,
          },
        );

        if (existing.length > 0) {
          supplierId = existing[0].id;
        } else {
          // 2. Não existe -> precisa criar. Dados vêm de "contato"
          const name = contato?.nome?.trim() || 'Não definido';
          const document = (contato?.numeroDocumento || '').trim();
          const fantasyName = null;
          const city = contato?.endereco?.municipio?.trim() || 'Não informado';
          const uf = contato?.endereco?.uf?.trim() || 'NA';
          const code = fornecedor?.codigo ? String(fornecedor.codigo) : null;

          // document é UNIQUE e NOT NULL na tabela suppliers.
          // Se não vier numeroDocumento, geramos um placeholder único baseado no id_system
          // para não violar a constraint.
          const safeDocument = document || `SEM-DOC-${idSystem}`;

          // Verifica também se já existe supplier com esse document
          // (caso o mesmo fornecedor apareça com id_system diferente em outro payload)
          const existingByDoc = await queryInterface.sequelize.query(
            `SELECT id, id_system FROM suppliers WHERE document = :document LIMIT 1`,
            {
              replacements: { document: safeDocument },
              type: QueryTypes.SELECT,
            },
          );

          if (existingByDoc.length > 0) {
            supplierId = existingByDoc[0].id;

            // Se o supplier existente não tiver id_system, preenche agora
            if (!existingByDoc[0].id_system) {
              await queryInterface.sequelize.query(
                `UPDATE suppliers SET id_system = :idSystem, code = COALESCE(code, :code), updated_at = NOW() WHERE id = :id`,
                {
                  replacements: { idSystem, code, id: supplierId },
                  type: QueryTypes.UPDATE,
                },
              );
            }
          } else {
            const newId = Sequelize.literal('gen_random_uuid()');

            const inserted = await queryInterface.sequelize.query(
              `
              INSERT INTO suppliers (id, name, document, fantasy_name, city, uf, id_system, code, created_at, updated_at)
              VALUES (gen_random_uuid(), :name, :document, :fantasyName, :city, :uf, :idSystem, :code, NOW(), NOW())
              RETURNING id
              `,
              {
                replacements: {
                  name,
                  document: safeDocument,
                  fantasyName,
                  city,
                  uf,
                  idSystem,
                  code,
                },
                type: QueryTypes.SELECT,
              },
            );

            supplierId = inserted[0].id;
          }
        }

        supplierCache.set(idSystem, supplierId);
      }

      // 3. Atualiza a invoice com o supplier_id encontrado/criado
      await queryInterface.sequelize.query(
        `UPDATE invoices SET supplier_id = :supplierId WHERE id = :invoiceId`,
        {
          replacements: { supplierId, invoiceId: invoice.id },
          type: QueryTypes.UPDATE,
        },
      );
    }

    console.log(
      `[populate-invoice-supplier-id] Concluído. ${supplierCache.size} suppliers distintos processados.`,
    );
  },

  async down(queryInterface, Sequelize) {
    // Reverte apenas o vínculo nas invoices; não remove os suppliers criados
    // (pois pode haver vínculos manuais feitos depois da migration).
    await queryInterface.sequelize.query(
      `UPDATE invoices SET supplier_id = NULL WHERE supplier_id IS NOT NULL`,
    );
  },
};