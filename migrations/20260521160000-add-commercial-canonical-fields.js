'use strict';

const addColumnIfMissing = async (queryInterface, tableName, columnName, definition, transaction) => {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition, { transaction });
  }
};

const removeColumnIfExists = async (queryInterface, tableName, columnName, transaction) => {
  const table = await queryInterface.describeTable(tableName);
  if (table[columnName]) {
    await queryInterface.removeColumn(tableName, columnName, { transaction });
  }
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await addColumnIfMissing(queryInterface, 'orders', 'source_system', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_number', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_store_order_number', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_status_id', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_status_name', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_invoice_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_store_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'external_unit_business_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'source_payload', { type: Sequelize.JSONB, allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'total_products', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'total_order', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'discount_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'discount_type', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'other_expenses', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'freight_charged', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'freight_cost', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'freight_by_account', { type: Sequelize.INTEGER, allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'gross_weight', { type: Sequelize.DECIMAL(14, 4), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'tax_commission', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'tax_base_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'marketplace_fee', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'orders', 'payment_fee', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);

      await addColumnIfMissing(queryInterface, 'order_items', 'product_id', { type: Sequelize.UUID, allowNull: true, references: { model: 'products', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'source_system', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'integrations_id', { type: Sequelize.UUID, allowNull: true, references: { model: 'integrations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'external_item_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'external_product_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'source_payload', { type: Sequelize.JSONB, allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'unit_price', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'gross_total', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'discount_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'net_total', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'commission_base', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'commission_rate', { type: Sequelize.DECIMAL(8, 4), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'commission_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'average_cost_snapshot', { type: Sequelize.DECIMAL(14, 4), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'total_cost_snapshot', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'order_items', 'cost_source', { type: Sequelize.STRING(30), allowNull: true }, transaction);

      await addColumnIfMissing(queryInterface, 'products', 'source_system', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'integrations_id', { type: Sequelize.UUID, allowNull: true, references: { model: 'integrations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'external_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'source_payload', { type: Sequelize.JSONB, allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'unit', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'brand', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'gross_weight', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'net_weight', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'gtin', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'gtin_package', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'ncm', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'cest', { type: Sequelize.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_external_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_contact_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_name', { type: Sequelize.STRING(255), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_product_code', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_cost_price', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'supplier_purchase_price', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'stock_virtual_total', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'average_cost', { type: Sequelize.DECIMAL(14, 4), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'products', 'average_cost_updated_at', { type: Sequelize.DATE, allowNull: true }, transaction);

      await addColumnIfMissing(queryInterface, 'invoices', 'source_system', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'external_id', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_series', { type: Sequelize.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_products_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_freight_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_discount_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_other_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'invoice_total_tax_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'icms_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'ipi_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'pis_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'cofins_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'difal_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'ibs_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'cbs_value', { type: Sequelize.DECIMAL(14, 2), allowNull: true, defaultValue: 0 }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'destination_uf', { type: Sequelize.STRING(2), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'destination_city', { type: Sequelize.STRING(100), allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'xml_url', { type: Sequelize.TEXT, allowNull: true }, transaction);
      await addColumnIfMissing(queryInterface, 'invoices', 'source_payload', { type: Sequelize.JSONB, allowNull: true }, transaction);

      await queryInterface.addIndex('orders', ['integrations_id', 'external_id'], { name: 'idx_orders_integration_external_id', transaction }).catch(() => null);
      await queryInterface.addIndex('orders', ['external_invoice_id'], { name: 'idx_orders_external_invoice_id', transaction }).catch(() => null);
      await queryInterface.addIndex('order_items', ['product_id'], { name: 'idx_order_items_product_id', transaction }).catch(() => null);
      await queryInterface.addIndex('products', ['integrations_id', 'external_id'], { name: 'idx_products_integration_external_id', transaction }).catch(() => null);
      await queryInterface.addIndex('invoices', ['integrations_id', 'external_id'], { name: 'idx_invoices_integration_external_id', transaction }).catch(() => null);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const invoiceColumns = [
        'source_payload', 'xml_url', 'destination_city', 'destination_uf', 'cbs_value', 'ibs_value',
        'difal_value', 'cofins_value', 'pis_value', 'ipi_value', 'icms_value', 'invoice_total_tax_value',
        'invoice_other_value', 'invoice_discount_value', 'invoice_freight_value', 'invoice_products_value',
        'invoice_value', 'invoice_series', 'external_id', 'source_system',
      ];
      const productColumns = [
        'average_cost_updated_at', 'average_cost', 'stock_virtual_total', 'supplier_purchase_price',
        'supplier_cost_price', 'supplier_product_code', 'supplier_name', 'supplier_contact_id',
        'supplier_external_id', 'cest', 'ncm', 'gtin_package', 'gtin', 'net_weight', 'gross_weight',
        'brand', 'unit', 'source_payload', 'external_id', 'integrations_id', 'source_system',
      ];
      const orderItemColumns = [
        'cost_source', 'total_cost_snapshot', 'average_cost_snapshot', 'commission_value',
        'commission_rate', 'commission_base', 'net_total', 'discount_value', 'gross_total',
        'unit_price', 'source_payload', 'external_product_id', 'external_item_id', 'integrations_id',
        'source_system', 'product_id',
      ];
      const orderColumns = [
        'payment_fee', 'marketplace_fee', 'tax_base_value', 'tax_commission', 'gross_weight',
        'freight_by_account', 'freight_cost', 'freight_charged', 'other_expenses', 'discount_type',
        'discount_value', 'total_order', 'total_products', 'source_payload', 'external_unit_business_id',
        'external_store_id', 'external_invoice_id', 'external_status_name', 'external_status_id',
        'external_store_order_number', 'external_number', 'external_id', 'source_system',
      ];

      for (const column of invoiceColumns) await removeColumnIfExists(queryInterface, 'invoices', column, transaction);
      for (const column of productColumns) await removeColumnIfExists(queryInterface, 'products', column, transaction);
      for (const column of orderItemColumns) await removeColumnIfExists(queryInterface, 'order_items', column, transaction);
      for (const column of orderColumns) await removeColumnIfExists(queryInterface, 'orders', column, transaction);

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
