'use strict';

// SupplierMapping precisa saber de qual integração é cada código de
// fornecedor — um mesmo supplier_product_code pode legitimamente apontar
// pra produtos diferentes em integrações diferentes (Bling x Tecinco).
// Pra derivar isso a partir de unit_business_id, unit_businesses.integrations_id
// precisa primeiro refletir a realidade: hoje está quase todo marcado como
// Bling, mesmo em lojas que a Tecinco já opera ativamente.
//
// Passos desta migração (nesta ordem):
//   1. Corrige unit_businesses.integrations_id (Bling só nas 5 lojas
//      confirmadas; Tecinco no resto).
//   2. Adiciona product_supplier_maps.integrations_id, derruba a constraint
//      única antiga (product_id, supplier_product_code) — duplicar uma
//      linha cria uma segunda com o mesmo par, que essa constraint proibiria
//      — e duplica os mappings cujo produto já tem integration_mapping
//      tanto pra Bling quanto pra Tecinco (ou nenhuma das duas).
//   3. Cria a constraint nova (integrations_id, supplier_product_code),
//      já sem conflito, com a duplicação completa.
//   4. Cria o trigger de validação cruzada contra product_configs.gtin/
//      gtin_package — só depois da duplicação em massa, pra não barrar a
//      carga inicial dos ~5249 registros.
//
// Só schema/dado — os consumidores que hoje criam/consultam SupplierMapping
// sem informar integrations_id continuam funcionando (coluna nullable),
// mas sem o escopo por integração até serem ajustados numa fase seguinte.

const BLING_EXCEPTION_UNIT_BUSINESS_IDS = [
  '361b5640-ec04-4b3f-8191-fe3ac5f134c4', // Loja 21 - CD MG
  '2d4a638e-1738-48c5-ac8b-d6c120ffa2e5', // Loja Pax Meli
  '5c67538f-e30d-4f27-84e1-e4929900bbdc', // Site Novo - www.paxpneus.com.br
  '57c22721-8409-428a-87f5-4849ec0379af', // Shopee
  '84d5fd45-1b6f-4cb9-a6e5-05c700b9eebc', // Sem Loja
];

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. unit_businesses.integrations_id
      await queryInterface.sequelize.query(
        `
        UPDATE unit_businesses
        SET integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
        WHERE id IN (${BLING_EXCEPTION_UNIT_BUSINESS_IDS.map((id) => `'${id}'`).join(', ')});

        UPDATE unit_businesses
        SET integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco')
        WHERE id NOT IN (${BLING_EXCEPTION_UNIT_BUSINESS_IDS.map((id) => `'${id}'`).join(', ')});
        `,
        { transaction },
      );

      // 2a. Coluna nova em product_supplier_maps. A constraint antiga
      // (product_id, supplier_product_code) precisa cair AGORA, antes da
      // duplicação abaixo — duplicar uma linha significa criar uma segunda
      // linha com o MESMO (product_id, supplier_product_code) (só o
      // integrations_id difere), o que a constraint antiga rejeitaria. A
      // constraint nova só entra depois que a duplicação termina (passo 2f).
      await queryInterface.sequelize.query(
        `
        ALTER TABLE product_supplier_maps
          ADD COLUMN integrations_id UUID REFERENCES integrations(id);

        ALTER TABLE product_supplier_maps
          DROP CONSTRAINT IF EXISTS product_supplier_maps_product_id_supplier_product_code_unique;
        `,
        { transaction },
      );

      // 2b. Marca como Bling todo mapping cujo produto tem integration_mapping pra Bling
      await queryInterface.sequelize.query(
        `
        UPDATE product_supplier_maps psm
        SET integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
        WHERE EXISTS (
          SELECT 1 FROM integration_mappings im
          WHERE im.entity_type = 'PRODUCT' AND im.internal_id = psm.product_id::text
            AND im.integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
        );
        `,
        { transaction },
      );

      // 2c. Duplica pra Tecinco os que também têm mapping Tecinco (caso "ambas")
      await queryInterface.sequelize.query(
        `
        INSERT INTO product_supplier_maps (id, product_id, supplier_cnpj, supplier_product_code, integrations_id, created_at, updated_at)
        SELECT gen_random_uuid(), psm.product_id, psm.supplier_cnpj, psm.supplier_product_code,
               (SELECT id FROM integrations WHERE name = 'Tecinco'), now(), now()
        FROM product_supplier_maps psm
        WHERE psm.integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
          AND EXISTS (
            SELECT 1 FROM integration_mappings im
            WHERE im.entity_type = 'PRODUCT' AND im.internal_id = psm.product_id::text
              AND im.integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco')
          );
        `,
        { transaction },
      );

      // 2d. Os que sobraram sem integrations_id e têm mapping só Tecinco
      await queryInterface.sequelize.query(
        `
        UPDATE product_supplier_maps psm
        SET integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco')
        WHERE psm.integrations_id IS NULL
          AND EXISTS (
            SELECT 1 FROM integration_mappings im
            WHERE im.entity_type = 'PRODUCT' AND im.internal_id = psm.product_id::text
              AND im.integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco')
          );
        `,
        { transaction },
      );

      // 2e. Quem não tem integration_mapping nem pra Bling nem pra Tecinco: duplica também
      await queryInterface.sequelize.query(
        `
        INSERT INTO product_supplier_maps (id, product_id, supplier_cnpj, supplier_product_code, integrations_id, created_at, updated_at)
        SELECT gen_random_uuid(), psm.product_id, psm.supplier_cnpj, psm.supplier_product_code,
               (SELECT id FROM integrations WHERE name = 'Tecinco'), now(), now()
        FROM product_supplier_maps psm
        WHERE psm.integrations_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM integration_mappings im
            WHERE im.entity_type = 'PRODUCT' AND im.internal_id = psm.product_id::text
              AND im.integrations_id IN (
                (SELECT id FROM integrations WHERE name = 'Bling'),
                (SELECT id FROM integrations WHERE name = 'Tecinco')
              )
          );

        UPDATE product_supplier_maps psm
        SET integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
        WHERE psm.integrations_id IS NULL;
        `,
        { transaction },
      );

      // 2f. Cria a constraint nova: (integrations_id, supplier_product_code)
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX product_supplier_maps_integrations_id_code_unique
          ON product_supplier_maps (integrations_id, supplier_product_code)
          WHERE integrations_id IS NOT NULL;
        `,
        { transaction },
      );

      // 3. Trigger: supplier_product_code não pode colidir com o gtin/gtin_package
      // de ProductConfig de OUTRO produto na mesma integração. Criada só agora,
      // depois da duplicação acima, pra não barrar a carga inicial.
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_supplier_mapping_gtin_conflict()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.supplier_product_code IS NOT NULL AND NEW.supplier_product_code <> '' AND NEW.integrations_id IS NOT NULL THEN
            IF EXISTS (
              SELECT 1
              FROM product_configs pc
              JOIN unit_businesses ub ON ub.id = pc.unit_business_id
              WHERE ub.integrations_id = NEW.integrations_id
                AND pc.product_id <> NEW.product_id
                AND (pc.gtin = NEW.supplier_product_code OR pc.gtin_package = NEW.supplier_product_code)
            ) THEN
              RAISE EXCEPTION
                'supplier_product_code % já é o gtin/gtin_package de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                NEW.supplier_product_code, NEW.product_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trigger_prevent_supplier_mapping_gtin_conflict
        BEFORE INSERT OR UPDATE OF supplier_product_code, integrations_id, product_id ON product_supplier_maps
        FOR EACH ROW
        EXECUTE FUNCTION prevent_supplier_mapping_gtin_conflict();
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 3. Trigger de validação
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS trigger_prevent_supplier_mapping_gtin_conflict ON product_supplier_maps;
        DROP FUNCTION IF EXISTS prevent_supplier_mapping_gtin_conflict();
        `,
        { transaction },
      );

      // 2. Remove as linhas duplicadas (inseridas nos passos 2c/2e — a
      // Tecinco de um par onde a Bling irmã, mesmo product_id+código,
      // continua existindo), derruba a constraint nova, recria a antiga,
      // remove a coluna.
      await queryInterface.sequelize.query(
        `
        DELETE FROM product_supplier_maps psm_tecinco
        WHERE psm_tecinco.integrations_id = (SELECT id FROM integrations WHERE name = 'Tecinco')
          AND EXISTS (
            SELECT 1 FROM product_supplier_maps psm_bling
            WHERE psm_bling.integrations_id = (SELECT id FROM integrations WHERE name = 'Bling')
              AND psm_bling.product_id = psm_tecinco.product_id
              AND psm_bling.supplier_product_code = psm_tecinco.supplier_product_code
          );
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS product_supplier_maps_integrations_id_code_unique;

        ALTER TABLE product_supplier_maps
          ADD CONSTRAINT product_supplier_maps_product_id_supplier_product_code_unique
          UNIQUE (product_id, supplier_product_code);

        ALTER TABLE product_supplier_maps DROP COLUMN IF EXISTS integrations_id;
        `,
        { transaction },
      );

      // 1. unit_businesses.integrations_id — não dá pra restaurar o estado
      // anterior com precisão (era dado incorreto/legado, com a maioria
      // das lojas Tecinco erroneamente marcada como Bling). O down não
      // reverte esta parte.

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
