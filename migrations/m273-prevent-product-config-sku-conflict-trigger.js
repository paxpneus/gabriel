'use strict';

// ProductConfig.sku nunca teve proteção nenhuma contra colidir com outro
// produto — só gtin tem isso (trigger_prevent_product_config_gtin_conflict,
// m264, escopado por unit_business_id). A análise de duplicidade Tecinco
// desta sessão confirmou em produção códigos como sku=48681 vinculados a
// 62 produtos físicos diferentes — exatamente o tipo de dado ruim que essa
// falta de proteção permite.
//
// Diferente do trigger de gtin (escopado só pela unit_business), este é
// escopado pela INTEGRAÇÃO INTEIRA (via unit_businesses.integrations_id):
// sku/código de fábrica representa o produto físico dentro da integração
// como um todo, não só numa loja. Checa contra dois alvos: outro
// ProductConfig.sku na mesma integração, E SupplierMapping.supplier_product_code
// na mesma integração (pra um produto diferente).
//
// Também estende (CREATE OR REPLACE, não recria o trigger)
// prevent_supplier_mapping_gtin_conflict (m263) pra checar contra
// ProductConfig.sku além de gtin — fecha a mesma checagem na direção
// oposta, mantendo as duas simetricamente protegidas (igual já é pra
// gtin desde m263/m264).
//
// Não falha em cima de dado ruim já existente — só valida INSERT/UPDATE
// novos.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_product_config_sku_conflict()
        RETURNS TRIGGER AS $$
        DECLARE
          target_integrations_id UUID;
          conflicting_id UUID;
        BEGIN
          IF NEW.sku IS NOT NULL AND NEW.sku <> '' THEN
            SELECT integrations_id INTO target_integrations_id FROM unit_businesses WHERE id = NEW.unit_business_id;

            IF target_integrations_id IS NOT NULL THEN
              SELECT pc.product_id INTO conflicting_id
              FROM product_configs pc
              JOIN unit_businesses ub ON ub.id = pc.unit_business_id
              WHERE ub.integrations_id = target_integrations_id
                AND pc.product_id <> NEW.product_id
                AND pc.sku = NEW.sku
              LIMIT 1;

              IF conflicting_id IS NOT NULL THEN
                RAISE EXCEPTION
                  'sku % já pertence a outro produto (product_id=%) na mesma integração (integrations_id=%)',
                  NEW.sku, conflicting_id, target_integrations_id;
              END IF;

              SELECT psm.product_id INTO conflicting_id
              FROM product_supplier_maps psm
              WHERE psm.integrations_id = target_integrations_id
                AND psm.product_id <> NEW.product_id
                AND psm.supplier_product_code = NEW.sku
              LIMIT 1;

              IF conflicting_id IS NOT NULL THEN
                RAISE EXCEPTION
                  'sku % já é o supplier_product_code de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                  NEW.sku, conflicting_id, target_integrations_id;
              END IF;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trigger_prevent_product_config_sku_conflict
        BEFORE INSERT OR UPDATE OF sku, unit_business_id
        ON product_configs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_product_config_sku_conflict();
        `,
        { transaction },
      );

      // Estende (mesma função, mesmo trigger já criado em m263) pra também
      // checar ProductConfig.sku, não só gtin.
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
                AND (pc.gtin = NEW.supplier_product_code OR pc.sku = NEW.supplier_product_code)
            ) THEN
              RAISE EXCEPTION
                'supplier_product_code % já é o gtin/sku de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                NEW.supplier_product_code, NEW.product_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
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
        DROP TRIGGER IF EXISTS trigger_prevent_product_config_sku_conflict ON product_configs;
        DROP FUNCTION IF EXISTS prevent_product_config_sku_conflict();
        `,
        { transaction },
      );

      // Volta prevent_supplier_mapping_gtin_conflict pra checar só gtin
      // (estado de m263/m265, antes desta migração).
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
                AND pc.gtin = NEW.supplier_product_code
            ) THEN
              RAISE EXCEPTION
                'supplier_product_code % já é o gtin de outro produto (product_id=%) na mesma integração (integrations_id=%)',
                NEW.supplier_product_code, NEW.product_id, NEW.integrations_id;
            END IF;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
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
