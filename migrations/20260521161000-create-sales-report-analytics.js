'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ─── external_order_status_mappings ───────────────────────────────────
      await queryInterface.createTable('external_order_status_mappings', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        integration_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'integrations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        source_system: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        external_status_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        external_status_value: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        normalized_status: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        display_name: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        is_cancelled: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        is_final: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('external_order_status_mappings', {
        fields: ['integration_id', 'external_status_id'],
        type: 'unique',
        name: 'external_order_status_mappings_integration_status_unique',
        transaction,
      });

      // ─── invoice_fiscal_items ─────────────────────────────────────────────
      await queryInterface.createTable('invoice_fiscal_items', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        invoice_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'invoices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        product_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        item_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        sku: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        description: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        unit_price: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ncm: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        cest: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        cfop: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        gtin: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        approx_tax_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        icms_rate: {
          type: Sequelize.DECIMAL(8, 4),
          defaultValue: 0,
        },
        icms_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ipi_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        pis_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cofins_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        difal_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ibs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cbs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('invoice_fiscal_items', {
        fields: ['invoice_id', 'sku', 'cfop', 'item_number'],
        type: 'unique',
        name: 'invoice_fiscal_items_invoice_sku_cfop_item_unique',
        transaction,
      });

      // ─── sales_order_snapshots ────────────────────────────────────────────
      await queryInterface.createTable('sales_order_snapshots', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        order_id: {
          type: Sequelize.UUID,
          allowNull: false,
          unique: true,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        invoice_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'invoices', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        integration_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'integrations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        customer_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'customers', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        store_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'stores', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        source_system: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        external_order_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        external_order_number: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        external_invoice_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        invoice_number: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        invoice_key: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        order_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        invoice_date: {
          type: Sequelize.DATEONLY,
          allowNull: true,
        },
        emitted_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        destination_uf: {
          type: Sequelize.STRING(2),
          allowNull: true,
        },
        destination_city: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        status_id: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        status_name: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        status_value: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        snapshot_status: {
          type: Sequelize.STRING(30),
          allowNull: false,
          defaultValue: 'open',
        },
        items_quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_products: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_order: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        discount_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        other_expenses: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        freight_charged: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        freight_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        freight_paid_by_company: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        freight_by_account: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        total_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_taxes: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_fees: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        tax_commission: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        marketplace_fee: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        payment_fee: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        icms_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ipi_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        pis_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cofins_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        difal_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ibs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cbs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        approx_tax_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        has_cost_fallback: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        has_invoice_data: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        source_payload: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      // ─── sales_order_item_snapshots ───────────────────────────────────────
      await queryInterface.createTable('sales_order_item_snapshots', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        order_snapshot_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'sales_order_snapshots', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        order_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        order_item_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'order_items', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        product_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        store_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'stores', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        order_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        destination_uf: {
          type: Sequelize.STRING(2),
          allowNull: true,
        },
        source_system: {
          type: Sequelize.STRING(50),
          allowNull: true,
        },
        external_item_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        external_product_id: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        sku: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        description: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        unit: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        unit_price: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        gross_total: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        discount_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        net_total: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_cost_snapshot: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_cost_snapshot: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cost_source: {
          type: Sequelize.STRING(30),
          allowNull: true,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        commission_base: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        commission_rate: {
          type: Sequelize.DECIMAL(8, 4),
          defaultValue: 0,
        },
        commission_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ncm: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        cest: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        cfop: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        gtin: {
          type: Sequelize.STRING(20),
          allowNull: true,
        },
        approx_tax_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        icms_rate: {
          type: Sequelize.DECIMAL(8, 4),
          defaultValue: 0,
        },
        icms_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ipi_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        pis_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cofins_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        difal_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        ibs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        cbs_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        source_payload: {
          type: Sequelize.JSONB,
          allowNull: true,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('sales_order_item_snapshots', {
        fields: ['order_item_id'],
        type: 'unique',
        name: 'sales_order_item_snapshots_order_item_id_unique',
        transaction,
      });

      // ─── daily_sales_facts ────────────────────────────────────────────────
      await queryInterface.createTable('daily_sales_facts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        fact_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        items_quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_freight: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_freight: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_ticket: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_taxes: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_fees: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('daily_sales_facts', {
        fields: ['fact_date', 'unit_business_id'],
        type: 'unique',
        name: 'daily_sales_facts_date_unit_unique',
        transaction,
      });

      // ─── daily_sales_state_facts ──────────────────────────────────────────
      await queryInterface.createTable('daily_sales_state_facts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        fact_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        destination_uf: {
          type: Sequelize.STRING(2),
          allowNull: false,
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        items_quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_freight: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_freight: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_ticket: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('daily_sales_state_facts', {
        fields: ['fact_date', 'unit_business_id', 'destination_uf'],
        type: 'unique',
        name: 'daily_sales_state_facts_date_unit_uf_unique',
        transaction,
      });

      // ─── daily_sales_store_facts ──────────────────────────────────────────
      await queryInterface.createTable('daily_sales_store_facts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        fact_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        store_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'stores', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        items_quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_freight: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_ticket: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        piece_average_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        total_taxes: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_fees: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        contribution_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('daily_sales_store_facts', {
        fields: ['fact_date', 'unit_business_id', 'store_id'],
        type: 'unique',
        name: 'daily_sales_store_facts_date_unit_store_unique',
        transaction,
      });

      // ─── daily_sales_product_facts ────────────────────────────────────────
      await queryInterface.createTable('daily_sales_product_facts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        fact_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        product_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        sku: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        description: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        quantity: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
          defaultValue: 0,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('daily_sales_product_facts', {
        fields: ['fact_date', 'unit_business_id', 'sku'],
        type: 'unique',
        name: 'daily_sales_product_facts_date_unit_sku_unique',
        transaction,
      });

      // ─── daily_sales_status_facts ─────────────────────────────────────────
      await queryInterface.createTable('daily_sales_status_facts', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        fact_date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        unit_business_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'unit_businesses', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        status_id: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        status_name: {
          type: Sequelize.STRING(100),
          allowNull: false,
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        total_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        last_updated_at: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.NOW,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.NOW,
        },
      }, { transaction });

      await queryInterface.addConstraint('daily_sales_status_facts', {
        fields: ['fact_date', 'unit_business_id', 'status_id'],
        type: 'unique',
        name: 'daily_sales_status_facts_date_unit_status_unique',
        transaction,
      });

      // ─── indexes ──────────────────────────────────────────────────────────
      await queryInterface.addIndex('sales_order_snapshots',      ['order_date'],                    { name: 'idx_sos_order_date',      transaction });
      await queryInterface.addIndex('sales_order_snapshots',      ['order_date', 'store_id'],        { name: 'idx_sos_date_store',      transaction });
      await queryInterface.addIndex('sales_order_snapshots',      ['order_date', 'unit_business_id'],{ name: 'idx_sos_date_unit',       transaction });
      await queryInterface.addIndex('sales_order_snapshots',      ['order_date', 'destination_uf'],  { name: 'idx_sos_date_uf',         transaction });
      await queryInterface.addIndex('sales_order_snapshots',      ['order_date', 'status_id'],       { name: 'idx_sos_date_status',     transaction });
      await queryInterface.addIndex('sales_order_snapshots',      ['invoice_id'],                    { name: 'idx_sos_invoice_id',      transaction });
      await queryInterface.addIndex('sales_order_item_snapshots', ['order_snapshot_id'],             { name: 'idx_sois_order_snapshot', transaction });
      await queryInterface.addIndex('sales_order_item_snapshots', ['order_date', 'product_id'],      { name: 'idx_sois_date_product',   transaction });
      await queryInterface.addIndex('sales_order_item_snapshots', ['order_date', 'sku'],             { name: 'idx_sois_date_sku',       transaction });
      await queryInterface.addIndex('sales_order_item_snapshots', ['order_date', 'store_id'],        { name: 'idx_sois_date_store',     transaction });
      await queryInterface.addIndex('sales_order_item_snapshots', ['order_date', 'destination_uf'],  { name: 'idx_sois_date_uf',        transaction });
      await queryInterface.addIndex('daily_sales_facts',          ['fact_date'],                     { name: 'idx_dsf_fact_date',       transaction });
      await queryInterface.addIndex('daily_sales_state_facts',    ['fact_date', 'destination_uf'],   { name: 'idx_dssf_date_uf',        transaction });
      await queryInterface.addIndex('daily_sales_store_facts',    ['fact_date', 'store_id'],         { name: 'idx_dsstf_date_store',    transaction });
      await queryInterface.addIndex('daily_sales_product_facts',  ['fact_date', 'sku'],              { name: 'idx_dspf_date_sku',       transaction });
      await queryInterface.addIndex('daily_sales_status_facts',   ['fact_date', 'status_id'],        { name: 'idx_dssuf_date_status',   transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('daily_sales_status_facts',    { transaction });
      await queryInterface.dropTable('daily_sales_product_facts',   { transaction });
      await queryInterface.dropTable('daily_sales_store_facts',     { transaction });
      await queryInterface.dropTable('daily_sales_state_facts',     { transaction });
      await queryInterface.dropTable('daily_sales_facts',           { transaction });
      await queryInterface.dropTable('sales_order_item_snapshots',  { transaction });
      await queryInterface.dropTable('sales_order_snapshots',       { transaction });
      await queryInterface.dropTable('invoice_fiscal_items',        { transaction });
      await queryInterface.dropTable('external_order_status_mappings', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};