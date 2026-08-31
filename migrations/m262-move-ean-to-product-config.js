'use strict';

// Product.ean/ean_tribut é um espaço global (sem escopo por unit_business),
// compartilhado hoje por Bling e Tecinco. Isso permite que o EAN de um
// produto da Tecinco bloqueie a Bling de atualizar o EAN do "seu" produto
// (assertEanNotOwnedByAnotherProduct) e que a resolução de item de nota
// fiscal da Bling resolva pro produto errado quando o EAN já pertence, no
// nosso sistema, a um produto da Tecinco.
//
// ProductConfig já tem gtin/gtin_package (STRING(20), nullable, por
// unit_business_id) — hoje só a Bling os popula. Esta migração move o dado
// de Product.ean/ean_tribut pra dentro desses campos já existentes (sem
// renomear, sem coluna nova) e remove ean/ean_tribut de products.
//
// Só schema/dado nesta migração — os fluxos que hoje leem/escrevem
// Product.ean/ean_tribut diretamente (bling-api-fetch.queue.ts,
// tecinco-api-fetch.queue.ts, product.helpers.ts, etc.) são ajustados numa
// fase seguinte.
const BLING_UNIT_BUSINESS_ID = '361b5640-ec04-4b3f-8191-fe3ac5f134c4';

module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // "PENDING-*"/"PENDING-TRIBUT-*" são placeholders de import (não
      // EAN/GTIN reais) — alguns passam de 20 chars, o limite de
      // product_configs.gtin*. Limpa qualquer resquício desses placeholders
      // que já tenha sido copiado pra product_configs por uma execução
      // anterior desta migração que tenha falhado a meio caminho.
      await queryInterface.sequelize.query(
        `
        UPDATE product_configs SET gtin = NULL WHERE gtin LIKE 'PENDING%';
        UPDATE product_configs SET gtin_package = NULL WHERE gtin_package LIKE 'PENDING%';
        `,
        { transaction },
      );

      // Excluídos do backfill: não são dado real, então não há o que preservar.
      await queryInterface.sequelize.query(
        `
        UPDATE product_configs pc
        SET gtin = p.ean
        FROM products p
        WHERE pc.product_id = p.id
          AND (pc.gtin IS NULL OR pc.gtin = '')
          AND p.ean IS NOT NULL AND p.ean <> ''
          AND p.ean NOT LIKE 'PENDING%';
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        UPDATE product_configs pc
        SET gtin_package = p.ean_tribut
        FROM products p
        WHERE pc.product_id = p.id
          AND (pc.gtin_package IS NULL OR pc.gtin_package = '')
          AND p.ean_tribut IS NOT NULL AND p.ean_tribut <> ''
          AND p.ean_tribut NOT LIKE 'PENDING%';
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        DROP INDEX IF EXISTS products_ean_unique_idx;
        DROP INDEX IF EXISTS products_ean_unique;
        DROP INDEX IF EXISTS products_ean_tribut_unique;
        DROP TRIGGER IF EXISTS trigger_prevent_ean_conflict_across_products ON products;
        DROP FUNCTION IF EXISTS prevent_ean_conflict_across_products();
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE products DROP COLUMN IF EXISTS ean;
        ALTER TABLE products DROP COLUMN IF EXISTS ean_tribut;
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // Lossy se os dados divergirem entre unit businesses depois da migração:
  // um produto pode ter várias linhas em product_configs com gtin diferentes
  // (uma por unit_business). O down pega a primeira não-nula, priorizando a
  // unit business da Bling, e não tem como recompor o valor original exato
  // caso outra integração já tenha sobrescrito o gtin desde então.
  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // O modelo declara STRING(20), mas a coluna real em produção é
      // VARCHAR(50) (alterada fora do histórico de migrations) — recriamos
      // com a largura real pra não truncar dado que exista acima de 20 chars.
      await queryInterface.sequelize.query(
        `
        ALTER TABLE products ADD COLUMN IF NOT EXISTS ean VARCHAR(50);
        ALTER TABLE products ADD COLUMN IF NOT EXISTS ean_tribut VARCHAR(50);
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        UPDATE products p
        SET ean = pc.gtin
        FROM (
          SELECT DISTINCT ON (product_id) product_id, gtin
          FROM product_configs
          WHERE gtin IS NOT NULL AND gtin <> ''
          ORDER BY product_id, (unit_business_id = '${BLING_UNIT_BUSINESS_ID}') DESC, updated_at DESC
        ) pc
        WHERE pc.product_id = p.id;
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        UPDATE products p
        SET ean_tribut = pc.gtin_package
        FROM (
          SELECT DISTINCT ON (product_id) product_id, gtin_package
          FROM product_configs
          WHERE gtin_package IS NOT NULL AND gtin_package <> ''
          ORDER BY product_id, (unit_business_id = '${BLING_UNIT_BUSINESS_ID}') DESC, updated_at DESC
        ) pc
        WHERE pc.product_id = p.id;
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX products_ean_unique_idx
        ON products(ean)
        WHERE ean IS NOT NULL AND ean <> '';
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX products_ean_unique
        ON products (ean)
        WHERE ean IS NOT NULL AND ean != '';
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX products_ean_tribut_unique
        ON products (ean_tribut)
        WHERE ean_tribut IS NOT NULL AND ean_tribut != '';
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
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
