'use strict';

// product_supplier_maps já tem o índice único parcial
// product_supplier_maps_integrations_id_code_unique (m263) garantindo que
// não existam duas linhas com o mesmo (integrations_id,
// supplier_product_code) — mas nenhum ponto de criação usado pelo fluxo
// Tecinco (ensureSupplierMappings/backfillSupplierMappingByEan em
// product.helpers.ts) tinha mensagem amigável pra isso; um conflito
// genuíno vazava como erro cru do Postgres (unique_violation) até a
// aplicação passar a capturar isso explicitamente nesta mesma sessão (ver
// SupplierMappingConflictError). Este trigger é redundante com o índice
// único pra garantir a unicidade em si — o valor dele é (a) mensagem
// amigável em vez do erro cru, e (b) defesa em profundidade pra qualquer
// escrita futura que não passe pela aplicação.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_duplicate_supplier_mapping()
        RETURNS TRIGGER AS $$
        DECLARE
          conflicting_id UUID;
        BEGIN
          IF NEW.integrations_id IS NOT NULL AND NEW.supplier_product_code IS NOT NULL AND NEW.supplier_product_code <> '' THEN
            SELECT product_id INTO conflicting_id
            FROM product_supplier_maps
            WHERE integrations_id = NEW.integrations_id
              AND supplier_product_code = NEW.supplier_product_code
              AND id <> NEW.id
            LIMIT 1;

            IF conflicting_id IS NOT NULL THEN
              RAISE EXCEPTION
                'Não é possível vincular: o código % já está mapeado (SupplierMapping) pra outro produto (product_id=%) nessa mesma integração (integrations_id=%) — só pode existir uma linha de SupplierMapping por código+integração',
                NEW.supplier_product_code, conflicting_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trigger_prevent_duplicate_supplier_mapping
        BEFORE INSERT OR UPDATE OF supplier_product_code, integrations_id ON product_supplier_maps
        FOR EACH ROW
        EXECUTE FUNCTION prevent_duplicate_supplier_mapping();
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
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS trigger_prevent_duplicate_supplier_mapping ON product_supplier_maps;
        DROP FUNCTION IF EXISTS prevent_duplicate_supplier_mapping();
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
