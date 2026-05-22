'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {

      // ── 1. daily_sales_status_facts: corrigir UNIQUE e status_display_name ──

      await queryInterface.removeConstraint(
        'daily_sales_status_facts',
        'daily_sales_status_facts_date_unit_status_unique',
        { transaction },
      );

      await queryInterface.addConstraint('daily_sales_status_facts', {
        fields: ['fact_date', 'unit_business_id', 'integration_id', 'status_normalized'],
        type: 'unique',
        name: 'daily_sales_status_facts_date_unit_integration_status_unique',
        transaction,
      });

      await queryInterface.changeColumn(
        'daily_sales_status_facts',
        'status_display_name',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction },
      );

      // ── 2. integration_order_status_mappings: remover FK e UNIQUE duplicadas ─

      await queryInterface.removeConstraint(
        'integration_order_status_mappings',
        'external_order_status_mappings_integration_id_fkey',
        { transaction },
      );

      await queryInterface.removeConstraint(
        'integration_order_status_mappings',
        'external_order_status_mappings_integration_status_unique',
        { transaction },
      );

      // ── 3. invoice_fiscal_items: recriar UNIQUE sem item_number ─────────────

      await queryInterface.removeConstraint(
        'invoice_fiscal_items',
        'invoice_fiscal_items_invoice_sku_cfop_item_unique',
        { transaction },
      );

      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'sku', 'cfop'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_sku_cfop_unique',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {

      // Restaurar UNIQUE de status_facts
      await queryInterface.removeConstraint(
        'daily_sales_status_facts',
        'daily_sales_status_facts_date_unit_integration_status_unique',
        { transaction },
      );
      await queryInterface.addConstraint('daily_sales_status_facts', {
        fields: ['fact_date', 'unit_business_id', 'status_normalized'],
        type: 'unique',
        name: 'daily_sales_status_facts_date_unit_status_unique',
        transaction,
      });

      // Restaurar NOT NULL em status_display_name
      await queryInterface.changeColumn(
        'daily_sales_status_facts',
        'status_display_name',
        { type: Sequelize.STRING(100), allowNull: false },
        { transaction },
      );

      // Restaurar UNIQUE de invoice_fiscal_items com item_number
      await queryInterface.removeConstraint(
        'invoice_fiscal_items',
        'invoice_fiscal_items_invoice_sku_cfop_unique',
        { transaction },
      );
      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'sku', 'cfop', 'item_number'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_sku_cfop_item_unique',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};