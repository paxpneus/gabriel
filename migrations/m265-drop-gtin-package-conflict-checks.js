'use strict';

// gtin_package (EAN tributário/de embalagem) deixou de participar de
// qualquer resolução/matching de produto na aplicação — motivo: o mesmo
// código podia legitimamente ser o gtin comercial de um produto e o
// gtin_package (tributário) de outro, e os dois triggers criados em m263/
// m264 tratavam isso como conflito e bloqueavam gravações válidas. A partir
// de agora gtin_package é só um campo armazenado (POST/PUT continuam
// gravando o valor recebido), sem nenhuma validação de unicidade nem uso em
// busca — toda resolução por código passa a considerar exclusivamente
// ProductConfig.gtin.
//
// Ajusta os dois triggers de conflito pra não olharem mais gtin_package:
//   - prevent_product_config_gtin_conflict (m264): só valida gtin contra o
//     gtin de outros produtos na mesma unit_business; para de disparar em
//     UPDATE de gtin_package.
//   - prevent_supplier_mapping_gtin_conflict (m263): só valida
//     supplier_product_code contra o gtin de ProductConfig na mesma
//     integração (deixa de comparar com gtin_package).
//
// A coluna product_configs.gtin_package NÃO é removida — continua existindo
// e sendo gravada, só sem nenhuma regra de banco em cima dela.
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_product_config_gtin_conflict()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.gtin IS NOT NULL AND NEW.gtin <> '' THEN
            IF EXISTS (
              SELECT 1 FROM product_configs pc
              WHERE pc.unit_business_id = NEW.unit_business_id
                AND pc.product_id <> NEW.product_id
                AND pc.gtin = NEW.gtin
            ) THEN
              RAISE EXCEPTION
                'gtin % já pertence a outro produto nessa unit_business (unit_business_id=%)',
                NEW.gtin, NEW.unit_business_id;
            END IF;
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_prevent_product_config_gtin_conflict ON product_configs;

        CREATE TRIGGER trigger_prevent_product_config_gtin_conflict
        BEFORE INSERT OR UPDATE OF gtin, unit_business_id, product_id
        ON product_configs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_product_config_gtin_conflict();

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

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `
        CREATE OR REPLACE FUNCTION prevent_product_config_gtin_conflict()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.gtin IS NOT NULL AND NEW.gtin <> '' THEN
            IF EXISTS (
              SELECT 1 FROM product_configs pc
              WHERE pc.unit_business_id = NEW.unit_business_id
                AND pc.product_id <> NEW.product_id
                AND (pc.gtin = NEW.gtin OR pc.gtin_package = NEW.gtin)
            ) THEN
              RAISE EXCEPTION
                'gtin % já pertence a outro produto nessa unit_business (unit_business_id=%)',
                NEW.gtin, NEW.unit_business_id;
            END IF;
          END IF;

          IF NEW.gtin_package IS NOT NULL AND NEW.gtin_package <> '' THEN
            IF EXISTS (
              SELECT 1 FROM product_configs pc
              WHERE pc.unit_business_id = NEW.unit_business_id
                AND pc.product_id <> NEW.product_id
                AND (pc.gtin = NEW.gtin_package OR pc.gtin_package = NEW.gtin_package)
            ) THEN
              RAISE EXCEPTION
                'gtin_package % já pertence a outro produto nessa unit_business (unit_business_id=%)',
                NEW.gtin_package, NEW.unit_business_id;
            END IF;
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_prevent_product_config_gtin_conflict ON product_configs;

        CREATE TRIGGER trigger_prevent_product_config_gtin_conflict
        BEFORE INSERT OR UPDATE OF gtin, gtin_package, unit_business_id, product_id
        ON product_configs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_product_config_gtin_conflict();

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
