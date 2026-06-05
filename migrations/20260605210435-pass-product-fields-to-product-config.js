'use strict';

const UNIT_BUSINESS_ID = '361b5640-ec04-4b3f-8191-fe3ac5f134c4';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO product_configs (
        id,
        product_id,
        unit_business_id,
        sku,
        price,
        supplier_cost_price,
        supplier_purchase_price,
        average_cost,
        average_cost_updated_at,
        ncm,
        cest,
        gtin,
        gtin_package,
        created_at,
        updated_at
      )
      SELECT
        gen_random_uuid(),
        p.id,
        '${UNIT_BUSINESS_ID}',
        p.sku,
        p.price,
        p.supplier_cost_price,
        p.supplier_purchase_price,
        p.average_cost,
        p.average_cost_updated_at,
        p.ncm,
        p.cest,
        p.gtin,
        p.gtin_package,
        NOW(),
        NOW()
      FROM products p
      ON CONFLICT (product_id, unit_business_id) DO NOTHING;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM product_configs
      WHERE unit_business_id = '${UNIT_BUSINESS_ID}';
    `);
  },
};