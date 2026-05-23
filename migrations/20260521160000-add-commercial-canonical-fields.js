'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ─── orders ───────────────────────────────────────────────────────────
      await queryInterface.addColumn('orders', 'source_system',               { type: Sequelize.STRING(50),    allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_id',                 { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_number',             { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_store_order_number', { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_status_id',          { type: Sequelize.STRING(50),    allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_status_name',        { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_invoice_id',         { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_store_id',           { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'external_unit_business_id',   { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'source_payload',              { type: Sequelize.JSONB,         allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'total_products',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'total_order',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'discount_value',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'discount_type',               { type: Sequelize.STRING(20),    allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'other_expenses',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'freight_charged',             { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'freight_cost',                { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'freight_by_account',          { type: Sequelize.INTEGER,       allowNull: true },              { transaction });
      await queryInterface.addColumn('orders', 'gross_weight',                { type: Sequelize.DECIMAL(14,4), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'tax_commission',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'tax_base_value',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'marketplace_fee',             { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('orders', 'payment_fee',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });

      await queryInterface.addIndex('orders', ['integrations_id', 'external_id'], { name: 'idx_orders_integration_external_id', transaction });
      await queryInterface.addIndex('orders', ['external_invoice_id'],             { name: 'idx_orders_external_invoice_id',    transaction });

      // ─── order_items ──────────────────────────────────────────────────────
      await queryInterface.addColumn('order_items', 'product_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'products', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      }, { transaction });
      await queryInterface.addColumn('order_items', 'source_system',        { type: Sequelize.STRING(50),    allowNull: true },              { transaction });
      await queryInterface.addColumn('order_items', 'integrations_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'integrations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      }, { transaction });
      await queryInterface.addColumn('order_items', 'external_item_id',     { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('order_items', 'external_product_id',  { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('order_items', 'source_payload',       { type: Sequelize.JSONB,         allowNull: true },              { transaction });
      await queryInterface.addColumn('order_items', 'unit_price',           { type: Sequelize.DECIMAL(14,4), allowNull: true },              { transaction });
      await queryInterface.addColumn('order_items', 'gross_total',          { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'discount_value',       { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'net_total',            { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'commission_base',      { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'commission_rate',      { type: Sequelize.DECIMAL(8,4),  allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'commission_value',     { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'average_cost_snapshot',{ type: Sequelize.DECIMAL(14,4), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'total_cost_snapshot',  { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('order_items', 'cost_source',          { type: Sequelize.STRING(30),    allowNull: true },              { transaction });

      await queryInterface.addIndex('order_items', ['product_id'], { name: 'idx_order_items_product_id', transaction });

      // ─── products ─────────────────────────────────────────────────────────
      await queryInterface.addColumn('products', 'source_system',           { type: Sequelize.STRING(50),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'integrations_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'integrations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      }, { transaction });
      await queryInterface.addColumn('products', 'external_id',             { type: Sequelize.STRING(100),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'source_payload',          { type: Sequelize.JSONB,         allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'unit',                    { type: Sequelize.STRING(20),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'brand',                   { type: Sequelize.STRING(100),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'gross_weight',            { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'net_weight',              { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'gtin',                    { type: Sequelize.STRING(20),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'gtin_package',            { type: Sequelize.STRING(20),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'ncm',                     { type: Sequelize.STRING(20),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'cest',                    { type: Sequelize.STRING(20),    allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_external_id',    { type: Sequelize.STRING(100),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_contact_id',     { type: Sequelize.STRING(100),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_name',           { type: Sequelize.STRING(255),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_product_code',   { type: Sequelize.STRING(100),   allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_cost_price',     { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_purchase_price', { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'stock_virtual_total',     { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'average_cost',            { type: Sequelize.DECIMAL(14,4), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'average_cost_updated_at', { type: Sequelize.DATE,          allowNull: true }, { transaction });

      await queryInterface.addIndex('products', ['integrations_id', 'external_id'], { name: 'idx_products_integration_external_id', transaction });

      // ─── invoices ─────────────────────────────────────────────────────────
      await queryInterface.addColumn('invoices', 'source_system',             { type: Sequelize.STRING(50),    allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'external_id',               { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'invoice_series',            { type: Sequelize.STRING(50),    allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'invoice_value',             { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'invoice_products_value',    { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'invoice_freight_value',     { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'invoice_discount_value',    { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'invoice_other_value',       { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'invoice_total_tax_value',   { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'icms_value',                { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'ipi_value',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'pis_value',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'cofins_value',              { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'difal_value',               { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'ibs_value',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'cbs_value',                 { type: Sequelize.DECIMAL(14,2), allowNull: true, defaultValue: 0 }, { transaction });
      await queryInterface.addColumn('invoices', 'destination_uf',            { type: Sequelize.STRING(2),     allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'destination_city',          { type: Sequelize.STRING(100),   allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'xml_url',                   { type: Sequelize.TEXT,          allowNull: true },              { transaction });
      await queryInterface.addColumn('invoices', 'source_payload',            { type: Sequelize.JSONB,         allowNull: true },              { transaction });

      await queryInterface.addIndex('invoices', ['integrations_id', 'external_id'], { name: 'idx_invoices_integration_external_id', transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ─── invoices ─────────────────────────────────────────────────────────
      await queryInterface.removeColumn('invoices', 'source_payload',          { transaction });
      await queryInterface.removeColumn('invoices', 'xml_url',                 { transaction });
      await queryInterface.removeColumn('invoices', 'destination_city',        { transaction });
      await queryInterface.removeColumn('invoices', 'destination_uf',          { transaction });
      await queryInterface.removeColumn('invoices', 'cbs_value',               { transaction });
      await queryInterface.removeColumn('invoices', 'ibs_value',               { transaction });
      await queryInterface.removeColumn('invoices', 'difal_value',             { transaction });
      await queryInterface.removeColumn('invoices', 'cofins_value',            { transaction });
      await queryInterface.removeColumn('invoices', 'pis_value',               { transaction });
      await queryInterface.removeColumn('invoices', 'ipi_value',               { transaction });
      await queryInterface.removeColumn('invoices', 'icms_value',              { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_total_tax_value', { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_other_value',     { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_discount_value',  { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_freight_value',   { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_products_value',  { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_value',           { transaction });
      await queryInterface.removeColumn('invoices', 'invoice_series',          { transaction });
      await queryInterface.removeColumn('invoices', 'external_id',             { transaction });
      await queryInterface.removeColumn('invoices', 'source_system',           { transaction });

      // ─── products ─────────────────────────────────────────────────────────
      await queryInterface.removeColumn('products', 'average_cost_updated_at', { transaction });
      await queryInterface.removeColumn('products', 'average_cost',            { transaction });
      await queryInterface.removeColumn('products', 'stock_virtual_total',     { transaction });
      await queryInterface.removeColumn('products', 'supplier_purchase_price', { transaction });
      await queryInterface.removeColumn('products', 'supplier_cost_price',     { transaction });
      await queryInterface.removeColumn('products', 'supplier_product_code',   { transaction });
      await queryInterface.removeColumn('products', 'supplier_name',           { transaction });
      await queryInterface.removeColumn('products', 'supplier_contact_id',     { transaction });
      await queryInterface.removeColumn('products', 'supplier_external_id',    { transaction });
      await queryInterface.removeColumn('products', 'cest',                    { transaction });
      await queryInterface.removeColumn('products', 'ncm',                     { transaction });
      await queryInterface.removeColumn('products', 'gtin_package',            { transaction });
      await queryInterface.removeColumn('products', 'gtin',                    { transaction });
      await queryInterface.removeColumn('products', 'net_weight',              { transaction });
      await queryInterface.removeColumn('products', 'gross_weight',            { transaction });
      await queryInterface.removeColumn('products', 'brand',                   { transaction });
      await queryInterface.removeColumn('products', 'unit',                    { transaction });
      await queryInterface.removeColumn('products', 'source_payload',          { transaction });
      await queryInterface.removeColumn('products', 'external_id',             { transaction });
      await queryInterface.removeColumn('products', 'integrations_id',         { transaction });
      await queryInterface.removeColumn('products', 'source_system',           { transaction });

      // ─── order_items ──────────────────────────────────────────────────────
      await queryInterface.removeColumn('order_items', 'cost_source',           { transaction });
      await queryInterface.removeColumn('order_items', 'total_cost_snapshot',   { transaction });
      await queryInterface.removeColumn('order_items', 'average_cost_snapshot', { transaction });
      await queryInterface.removeColumn('order_items', 'commission_value',      { transaction });
      await queryInterface.removeColumn('order_items', 'commission_rate',       { transaction });
      await queryInterface.removeColumn('order_items', 'commission_base',       { transaction });
      await queryInterface.removeColumn('order_items', 'net_total',             { transaction });
      await queryInterface.removeColumn('order_items', 'discount_value',        { transaction });
      await queryInterface.removeColumn('order_items', 'gross_total',           { transaction });
      await queryInterface.removeColumn('order_items', 'unit_price',            { transaction });
      await queryInterface.removeColumn('order_items', 'source_payload',        { transaction });
      await queryInterface.removeColumn('order_items', 'external_product_id',   { transaction });
      await queryInterface.removeColumn('order_items', 'external_item_id',      { transaction });
      await queryInterface.removeColumn('order_items', 'integrations_id',       { transaction });
      await queryInterface.removeColumn('order_items', 'source_system',         { transaction });
      await queryInterface.removeColumn('order_items', 'product_id',            { transaction });

      // ─── orders ───────────────────────────────────────────────────────────
      await queryInterface.removeColumn('orders', 'payment_fee',                 { transaction });
      await queryInterface.removeColumn('orders', 'marketplace_fee',             { transaction });
      await queryInterface.removeColumn('orders', 'tax_base_value',              { transaction });
      await queryInterface.removeColumn('orders', 'tax_commission',              { transaction });
      await queryInterface.removeColumn('orders', 'gross_weight',                { transaction });
      await queryInterface.removeColumn('orders', 'freight_by_account',          { transaction });
      await queryInterface.removeColumn('orders', 'freight_cost',                { transaction });
      await queryInterface.removeColumn('orders', 'freight_charged',             { transaction });
      await queryInterface.removeColumn('orders', 'other_expenses',              { transaction });
      await queryInterface.removeColumn('orders', 'discount_type',               { transaction });
      await queryInterface.removeColumn('orders', 'discount_value',              { transaction });
      await queryInterface.removeColumn('orders', 'total_order',                 { transaction });
      await queryInterface.removeColumn('orders', 'total_products',              { transaction });
      await queryInterface.removeColumn('orders', 'source_payload',              { transaction });
      await queryInterface.removeColumn('orders', 'external_unit_business_id',   { transaction });
      await queryInterface.removeColumn('orders', 'external_store_id',           { transaction });
      await queryInterface.removeColumn('orders', 'external_invoice_id',         { transaction });
      await queryInterface.removeColumn('orders', 'external_status_name',        { transaction });
      await queryInterface.removeColumn('orders', 'external_status_id',          { transaction });
      await queryInterface.removeColumn('orders', 'external_store_order_number', { transaction });
      await queryInterface.removeColumn('orders', 'external_number',             { transaction });
      await queryInterface.removeColumn('orders', 'external_id',                 { transaction });
      await queryInterface.removeColumn('orders', 'source_system',               { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};