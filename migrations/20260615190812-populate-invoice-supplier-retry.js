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

    console.log(`[populate-invoice-supplier-id-v2] ${invoices.length} invoices a processar.`);

    // Cache em memória para evitar buscar/criar o mesmo fornecedor várias vezes
    const supplierCache = new Map(); // key: id_system (fornecedor.id como string) -> supplier id (uuid)

    let matchedById = 0;
    let matchedByDocument = 0;
    let matchedByName = 0;
    let created = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const payload =
        typeof invoice.source_payload === 'string'
          ? JSON.parse(invoice.source_payload)
          : invoice.source_payload;

      const fornecedor = payload?.fornecedor;
      const contato = payload?.contato;

      if (!fornecedor?.id) {
        skipped++;
        continue;
      }

      const idSystem = String(fornecedor.id);

      let supplierId = supplierCache.get(idSystem);

      if (!supplierId) {
        // 1. Verifica se já existe supplier com esse id_system
        const existingById = await queryInterface.sequelize.query(
          `SELECT id FROM suppliers WHERE id_system = :idSystem LIMIT 1`,
          {
            replacements: { idSystem },
            type: QueryTypes.SELECT,
          },
        );

        if (existingById.length > 0) {
          supplierId = existingById[0].id;
          matchedById++;
        } else {
          const name = contato?.nome?.trim() || null;
          const document = (contato?.numeroDocumento || '').trim() || null;

          // 2. Tenta achar por document (CNPJ/CPF), se vier preenchido
          let existingByDoc = [];
          if (document) {
            existingByDoc = await queryInterface.sequelize.query(
              `SELECT id, id_system FROM suppliers WHERE document = :document LIMIT 1`,
              {
                replacements: { document },
                type: QueryTypes.SELECT,
              },
            );
          }

          if (existingByDoc.length > 0) {
            supplierId = existingByDoc[0].id;
            matchedByDocument++;

            if (!existingByDoc[0].id_system) {
              await queryInterface.sequelize.query(
                `UPDATE suppliers SET id_system = :idSystem, code = COALESCE(code, :code), updated_at = NOW() WHERE id = :id`,
                {
                  replacements: {
                    idSystem,
                    code: fornecedor?.codigo ? String(fornecedor.codigo) : null,
                    id: supplierId,
                  },
                  type: QueryTypes.UPDATE,
                },
              );
            }
          } else if (name) {
            // 3. Tenta achar por nome (case-insensitive, trim).
            // Pode haver mais de um supplier com nomes parecidos, então
            // usamos correspondência exata (case-insensitive) primeiro.
            const existingByName = await queryInterface.sequelize.query(
              `SELECT id, id_system, document FROM suppliers WHERE TRIM(LOWER(name)) = TRIM(LOWER(:name)) LIMIT 1`,
              {
                replacements: { name },
                type: QueryTypes.SELECT,
              },
            );

            if (existingByName.length > 0) {
              supplierId = existingByName[0].id;
              matchedByName++;

              const updates = [];
              const replacements = { id: supplierId };

              if (!existingByName[0].id_system) {
                updates.push('id_system = :idSystem');
                replacements.idSystem = idSystem;
              }

              // Se o supplier encontrado por nome não tem document (ou tem o placeholder)
              // e agora temos um document real, atualiza.
              if (
                document &&
                (!existingByName[0].document ||
                  existingByName[0].document.startsWith('SEM-DOC-'))
              ) {
                updates.push('document = :document');
                replacements.document = document;
              }

              if (updates.length) {
                await queryInterface.sequelize.query(
                  `UPDATE suppliers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = :id`,
                  {
                    replacements,
                    type: QueryTypes.UPDATE,
                  },
                );
              }
            } else {
              // 4. Não encontrou de jeito nenhum -> cria novo supplier
              const fantasyName = null;
              const city = contato?.endereco?.municipio?.trim() || 'Não informado';
              const uf = contato?.endereco?.uf?.trim() || 'NA';
              const code = fornecedor?.codigo ? String(fornecedor.codigo) : null;
              const safeDocument = document || `SEM-DOC-${idSystem}`;
              const safeName = name || 'Não definido';

              const inserted = await queryInterface.sequelize.query(
                `
                INSERT INTO suppliers (id, name, document, fantasy_name, city, uf, id_system, code, created_at, updated_at)
                VALUES (gen_random_uuid(), :name, :document, :fantasyName, :city, :uf, :idSystem, :code, NOW(), NOW())
                RETURNING id
                `,
                {
                  replacements: {
                    name: safeName,
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
              created++;
            }
          } else {
            // Sem document e sem nome -> cria com placeholders
            const safeDocument = `SEM-DOC-${idSystem}`;
            const code = fornecedor?.codigo ? String(fornecedor.codigo) : null;

            const inserted = await queryInterface.sequelize.query(
              `
              INSERT INTO suppliers (id, name, document, fantasy_name, city, uf, id_system, code, created_at, updated_at)
              VALUES (gen_random_uuid(), :name, :document, :fantasyName, :city, :uf, :idSystem, :code, NOW(), NOW())
              RETURNING id
              `,
              {
                replacements: {
                  name: 'Não definido',
                  document: safeDocument,
                  fantasyName: null,
                  city: 'Não informado',
                  uf: 'NA',
                  idSystem,
                  code,
                },
                type: QueryTypes.SELECT,
              },
            );

            supplierId = inserted[0].id;
            created++;
          }
        }

        supplierCache.set(idSystem, supplierId);
      }

      // 5. Atualiza a invoice com o supplier_id encontrado/criado
      await queryInterface.sequelize.query(
        `UPDATE invoices SET supplier_id = :supplierId WHERE id = :invoiceId`,
        {
          replacements: { supplierId, invoiceId: invoice.id },
          type: QueryTypes.UPDATE,
        },
      );
    }

    console.log(
      `[populate-invoice-supplier-id-v2] Concluído. ` +
        `${supplierCache.size} suppliers distintos processados. ` +
        `Match por id_system: ${matchedById}, por document: ${matchedByDocument}, ` +
        `por nome: ${matchedByName}, criados: ${created}, pulados (sem fornecedor.id): ${skipped}.`,
    );
  },

  async down(queryInterface, Sequelize) {
    // Reverte apenas o vínculo nas invoices; não remove ou desfaz updates feitos nos suppliers
    // (pois pode haver vínculos manuais feitos depois da migration).
    await queryInterface.sequelize.query(
      `UPDATE invoices SET supplier_id = NULL WHERE supplier_id IS NOT NULL`,
    );
  },
};