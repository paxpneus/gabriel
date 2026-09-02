'use strict';

// product_configs nunca teve proteção de banco equivalente à antiga
// trigger_prevent_ean_conflict_across_products (criada em m261, dropada em
// m262 junto com products.ean/ean_tribut quando esses dados migraram pra cá).
// Desde a Fase 1, gtin/gtin_package vivem em product_configs, mas sem
// nenhum trigger ou constraint impedindo dois produtos DIFERENTES de
// compartilharem o mesmo gtin/gtin_package na MESMA unit_business — a única
// proteção era a checagem em código (assertEanNotOwnedByAnotherProduct), que
// se provou insuficiente sozinha (bug real encontrado: checagem escopada
// errado deixou passar colisão entre duas lojas Tecinco pro mesmo produto).
//
// Escopo por unit_business_id (não pela integração inteira) — mesmo escopo
// que a checagem de aplicação já usa hoje; não muda a política atual, só
// formaliza ela como rede de segurança no banco.
//
// Não falha em cima de dado ruim já existente — trigger só valida
// INSERT/UPDATE novos, dados já conflitantes continuam intactos até alguém
// corrigir manualmente.
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

        CREATE TRIGGER trigger_prevent_product_config_gtin_conflict
        BEFORE INSERT OR UPDATE OF gtin, gtin_package, unit_business_id, product_id
        ON product_configs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_product_config_gtin_conflict();
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
        DROP TRIGGER IF EXISTS trigger_prevent_product_config_gtin_conflict ON product_configs;
        DROP FUNCTION IF EXISTS prevent_product_config_gtin_conflict();
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
