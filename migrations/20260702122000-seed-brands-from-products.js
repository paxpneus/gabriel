'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        WITH normalized_product_brands AS (
          SELECT
            lower(trim(brand)) AS normalized_name,
            min(trim(brand)) AS name
          FROM products
          WHERE brand IS NOT NULL
            AND trim(brand) <> ''
          GROUP BY lower(trim(brand))
        )
        INSERT INTO brands (
          id,
          name,
          seller_comission_tax_rate,
          manager_comission_tax_rate,
          created_at,
          updated_at
        )
        SELECT
          gen_random_uuid(),
          npb.name,
          0,
          0,
          NOW(),
          NOW()
        FROM normalized_product_brands npb
        WHERE NOT EXISTS (
          SELECT 1
          FROM brands b
          WHERE lower(trim(b.name)) = npb.normalized_name
        )
        `,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `
        WITH normalized_brands AS (
          SELECT DISTINCT ON (lower(trim(name)))
            id,
            lower(trim(name)) AS normalized_name
          FROM brands
          WHERE name IS NOT NULL
            AND trim(name) <> ''
          ORDER BY lower(trim(name)), created_at ASC
        )
        UPDATE products p
        SET
          brand_id = nb.id,
          updated_at = NOW()
        FROM normalized_brands nb
        WHERE p.brand IS NOT NULL
          AND trim(p.brand) <> ''
          AND lower(trim(p.brand)) = nb.normalized_name
          AND (p.brand_id IS DISTINCT FROM nb.id)
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
      UPDATE products
      SET
        brand_id = NULL,
        updated_at = NOW()
      WHERE brand_id IS NOT NULL
      `,
    );
  },
};
