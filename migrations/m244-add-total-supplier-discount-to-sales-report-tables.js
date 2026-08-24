'use strict';

// Persiste o total de supplier_discount agregado nas tabelas de nível-pedido
// (sales_order_snapshots) e de facts (daily_sales_facts, daily_sales_store_facts,
// daily_sales_product_facts). Necessário porque getReportFromFacts, usado em
// /api/sales-report quando nenhum filtro de produto/marca/medida/pedido é
// aplicado, lê exclusivamente dessas tabelas — nunca de
// sales_order_item_snapshots, onde supplier_discount_value já existia.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const column = {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
        defaultValue: 0,
      };

      await queryInterface.addColumn(
        'sales_order_snapshots',
        'total_supplier_discount',
        column,
        { transaction },
      );
      await queryInterface.addColumn(
        'daily_sales_facts',
        'total_supplier_discount',
        column,
        { transaction },
      );
      await queryInterface.addColumn(
        'daily_sales_store_facts',
        'total_supplier_discount',
        column,
        { transaction },
      );
      await queryInterface.addColumn(
        'daily_sales_product_facts',
        'total_supplier_discount',
        column,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn(
        'daily_sales_product_facts',
        'total_supplier_discount',
        { transaction },
      );
      await queryInterface.removeColumn(
        'daily_sales_store_facts',
        'total_supplier_discount',
        { transaction },
      );
      await queryInterface.removeColumn(
        'daily_sales_facts',
        'total_supplier_discount',
        { transaction },
      );
      await queryInterface.removeColumn(
        'sales_order_snapshots',
        'total_supplier_discount',
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
