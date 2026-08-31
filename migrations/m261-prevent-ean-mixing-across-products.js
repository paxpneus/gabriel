'use strict';

// products_ean_unique/products_ean_tribut_unique (ver m/migration
// 20260521140635-ean-constraint) já impedem dois produtos com o mesmo ean
// entre si, ou o mesmo ean_tribut entre si — mas não impedem a "mistura":
// o ean de um produto ser igual ao ean_tribut de outro. Um único índice
// parcial não cobre isso porque são colunas diferentes, então usamos um
// trigger que valida as duas colunas contra as duas colunas de qualquer
// outro produto antes de aceitar o INSERT/UPDATE.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION prevent_ean_conflict_across_products()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.ean IS NOT NULL AND NEW.ean <> '' THEN
          IF EXISTS (
            SELECT 1 FROM products
            WHERE id <> NEW.id
              AND (ean = NEW.ean OR ean_tribut = NEW.ean)
          ) THEN
            RAISE EXCEPTION
              'EAN % já está em uso (ean ou ean_tribut) por outro produto', NEW.ean;
          END IF;
        END IF;

        IF NEW.ean_tribut IS NOT NULL AND NEW.ean_tribut <> '' THEN
          IF EXISTS (
            SELECT 1 FROM products
            WHERE id <> NEW.id
              AND (ean = NEW.ean_tribut OR ean_tribut = NEW.ean_tribut)
          ) THEN
            RAISE EXCEPTION
              'EAN_TRIBUT % já está em uso (ean ou ean_tribut) por outro produto', NEW.ean_tribut;
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trigger_prevent_ean_conflict_across_products
      BEFORE INSERT OR UPDATE OF ean, ean_tribut ON "products"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_ean_conflict_across_products();
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trigger_prevent_ean_conflict_across_products
      ON "products";

      DROP FUNCTION IF EXISTS prevent_ean_conflict_across_products();
    `);
  },
};
