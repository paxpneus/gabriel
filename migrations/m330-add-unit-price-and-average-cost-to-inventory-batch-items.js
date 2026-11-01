'use strict';

// Preço de venda e custo médio do produto congelados quando o item entra no lote; price = unit_price × quantity_stock, nunca recalculado na bipagem.
// Backfill: unit_price sai do price gravado (leitura ou estoque), custo médio do kardex na data do item; sem origem → valor atual da ProductConfig.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'inventory_batch_items',
        'unit_price',
        { type: Sequelize.FLOAT, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'inventory_batch_items',
        'average_cost',
        { type: Sequelize.DECIMAL(14, 4), allowNull: true },
        { transaction },
      );

      // price antigo = lido × preço da última bipagem (item bipado) ou estoque × preço da criação (não bipado)
      await queryInterface.sequelize.query(
        `UPDATE inventory_batch_items
            SET unit_price = CASE
              WHEN price > 0 AND quantity_read > 0 THEN price / quantity_read
              WHEN price > 0 AND quantity_read = 0 AND quantity_stock > 0 THEN price / quantity_stock
            END`,
        { transaction },
      );

      // custo médio do kardex na data em que o item entrou no lote (só lote normal; divergência herda do pai abaixo)
      await queryInterface.sequelize.query(
        `UPDATE inventory_batch_items i
            SET average_cost = (
              SELECT sm.resulting_average_cost
                FROM stock_movements sm
               WHERE sm.product_id = i.product_id
                 AND sm.unit_business_id = b.unit_business_id
                 AND sm.is_active = true
                 AND sm.movement_date <= i.created_at
               ORDER BY sm.movement_date DESC, sm.created_at DESC
               LIMIT 1
            )
           FROM inventory_batches b
          WHERE b.id = i.inventory_batch_id
            AND b.type = 'REGULAR'`,
        { transaction },
      );

      // item do lote de divergência herda preço e custo do item do lote pai (mesmo produto)
      await queryInterface.sequelize.query(
        `UPDATE inventory_batch_items c
            SET unit_price = COALESCE(p.unit_price, c.unit_price),
                average_cost = p.average_cost
           FROM inventory_batches b, inventory_batch_items p
          WHERE b.id = c.inventory_batch_id
            AND b.type = 'DIVERGENCY'
            AND p.inventory_batch_id = b.batch_id_for_divergency
            AND p.product_id = c.product_id`,
        { transaction },
      );

      // sem origem histórica (ex.: price zerado pela correção manual) → valor atual da ProductConfig da loja do lote
      await queryInterface.sequelize.query(
        `UPDATE inventory_batch_items i
            SET unit_price = COALESCE(i.unit_price, (
                  SELECT pc.price FROM product_configs pc
                   WHERE pc.product_id = i.product_id AND pc.unit_business_id = b.unit_business_id
                   LIMIT 1
                ), 0),
                average_cost = COALESCE(i.average_cost, (
                  SELECT pc.average_cost FROM product_configs pc
                   WHERE pc.product_id = i.product_id AND pc.unit_business_id = b.unit_business_id
                   LIMIT 1
                ))
           FROM inventory_batches b
          WHERE b.id = i.inventory_batch_id
            AND (i.unit_price IS NULL OR i.average_cost IS NULL)`,
        { transaction },
      );

      // price passa a ser sempre estoque × preço congelado; total_price do lote acompanha
      await queryInterface.sequelize.query(
        `UPDATE inventory_batch_items SET price = unit_price * quantity_stock`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `UPDATE inventory_batches b
            SET total_price = COALESCE(
              (SELECT SUM(i.price) FROM inventory_batch_items i WHERE i.inventory_batch_id = b.id), 0)`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('inventory_batch_items', 'average_cost');
    await queryInterface.removeColumn('inventory_batch_items', 'unit_price');
  },
};
