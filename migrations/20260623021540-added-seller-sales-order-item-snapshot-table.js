'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ─── seller_sales_order_item_snapshots ────────────────────────────────
      // Tabela própria do seller_sales_report. NÃO confundir com a tabela
      // `sales_order_item_snapshots` já existente, que pertence a outro
      // relatório (snapshot fiscal/operacional por loja, com order_snapshot_id
      // obrigatório e colunas de imposto icms/ipi/pis/cofins).
      await queryInterface.createTable('seller_sales_order_item_snapshots', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true,
          allowNull: false,
        },
        order_item_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'order_items', key: 'id' },
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
        seller_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'contacts', key: 'id' },
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
        product_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'products', key: 'id' },
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
        product_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        product_brand: {
          type: Sequelize.STRING(100),
          allowNull: true,
        },
        product_measure: {
          type: Sequelize.STRING(50),
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
        net_total: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        average_cost: {
          type: Sequelize.DECIMAL(14, 4),
          defaultValue: 0,
        },
        total_cost: {
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
        markup_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        markup_pct: {
          type: Sequelize.DECIMAL(8, 2),
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
        is_valid_sale: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
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

      await queryInterface.addConstraint('seller_sales_order_item_snapshots', {
        fields: ['order_item_id'],
        type: 'unique',
        name: 'seller_sales_order_item_snapshots_order_item_id_unique',
        transaction,
      });

      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['order_date'], {
        name: 'idx_ssois_order_date',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['seller_id', 'order_date'], {
        name: 'idx_ssois_seller_date',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['unit_business_id', 'order_date'], {
        name: 'idx_ssois_unit_business_date',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['customer_id', 'order_date'], {
        name: 'idx_ssois_customer_date',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['product_id', 'order_date'], {
        name: 'idx_ssois_product_date',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['order_id'], {
        name: 'idx_ssois_order_id',
        transaction,
      });
      await queryInterface.addIndex('seller_sales_order_item_snapshots', ['is_valid_sale'], {
        name: 'idx_ssois_valid_sale',
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
      await queryInterface.dropTable('seller_sales_order_item_snapshots', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};