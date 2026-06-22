'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ─── daily_seller_product_facts ───────────────────────────────────────
      await queryInterface.createTable('daily_seller_product_facts', {
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
        seller_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'contacts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        product_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'products', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
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
        quantity_sold: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        total_sold: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_cost: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_commission: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_markup_value: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_contribution_value: {
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

      await queryInterface.addConstraint('daily_seller_product_facts', {
        fields: ['fact_date', 'seller_id', 'product_id'],
        type: 'unique',
        name: 'daily_seller_product_facts_date_seller_product_unique',
        transaction,
      });

      await queryInterface.addIndex('daily_seller_product_facts', ['fact_date'], {
        name: 'idx_dspf_fact_date',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_product_facts', ['seller_id'], {
        name: 'idx_dspf_seller_id',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_product_facts', ['product_id'], {
        name: 'idx_dspf_product_id',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_product_facts', ['fact_date', 'seller_id'], {
        name: 'idx_dspf_date_seller',
        transaction,
      });

      // ─── daily_seller_customer_facts ──────────────────────────────────────
      await queryInterface.createTable('daily_seller_customer_facts', {
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
        seller_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'contacts', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        customer_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'customers', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        customer_name: {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        orders_count: {
          type: Sequelize.INTEGER,
          defaultValue: 0,
        },
        total_purchased: {
          type: Sequelize.DECIMAL(14, 2),
          defaultValue: 0,
        },
        total_commission: {
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

      await queryInterface.addConstraint('daily_seller_customer_facts', {
        fields: ['fact_date', 'seller_id', 'customer_id'],
        type: 'unique',
        name: 'daily_seller_customer_facts_date_seller_customer_unique',
        transaction,
      });

      await queryInterface.addIndex('daily_seller_customer_facts', ['fact_date'], {
        name: 'idx_dscf_fact_date',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_customer_facts', ['seller_id'], {
        name: 'idx_dscf_seller_id',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_customer_facts', ['customer_id'], {
        name: 'idx_dscf_customer_id',
        transaction,
      });
      await queryInterface.addIndex('daily_seller_customer_facts', ['fact_date', 'seller_id'], {
        name: 'idx_dscf_date_seller',
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
      await queryInterface.dropTable('daily_seller_customer_facts', { transaction });
      await queryInterface.dropTable('daily_seller_product_facts', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};