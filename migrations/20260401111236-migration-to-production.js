'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. INTEGRATIONS
    await queryInterface.createTable('integrations', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      type: { type: Sequelize.ENUM('CHANNEL', 'SYSTEM'), allowNull: false },
      api_url: { type: Sequelize.STRING(255), allowNull: false },
      document: { type: Sequelize.STRING(11), allowNull: true },
      cnaes: { type: Sequelize.ARRAY(Sequelize.STRING), allowNull: true },
      allowed_channels: { type: Sequelize.ARRAY(Sequelize.STRING), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 2. CONFIG_TOKENS
    await queryInterface.createTable('config_tokens', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      integrations_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integrations', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      access_token: { type: Sequelize.TEXT, allowNull: true },
      refresh_token: { type: Sequelize.TEXT, allowNull: true },
      client_id: { type: Sequelize.STRING(255), allowNull: false },
      client_secret: { type: Sequelize.STRING(255), allowNull: false },
      access_token_url: { type: Sequelize.STRING(255), allowNull: true },
      auth_url: { type: Sequelize.STRING(255), allowNull: true },
      callback_url: { type: Sequelize.STRING(255), allowNull: true },
      oauth_state: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 3. CUSTOMERS
    await queryInterface.createTable('customers', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      type: { type: Sequelize.ENUM('F', 'J'), allowNull: false },
      document: { type: Sequelize.STRING(14), allowNull: false, unique: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 4. STEPS
    await queryInterface.createTable('steps', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      label_admin: { type: Sequelize.STRING(100), allowNull: false },
      label_system: { type: Sequelize.STRING(100), allowNull: false },
      sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 5. STORES 
    await queryInterface.createTable('stores', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: true },
      id_store_system: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 6. ORDERS 
    await queryInterface.createTable('orders', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      integration_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integrations', key: 'id' }
      },
      customer_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'customers', key: 'id' }
      },
      store_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'stores', key: 'id' }
      },
      id_order_system: { type: Sequelize.STRING(100), allowNull: true },
      number_order_system: { type: Sequelize.STRING(100), allowNull: true },
      number_order_channel: { type: Sequelize.STRING(100), allowNull: false },
      actual_step: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'PENDING' },
      actual_situation: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'ACTIVE' },
      collection_date: { type: Sequelize.DATE, allowNull: true },
      date: { type: Sequelize.DATE, allowNull: true },
      total_price: { type: Sequelize.DECIMAL, allowNull: true },
      nfe_emitted: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
      internal_status: {
        type: Sequelize.ENUM('OPEN', 'WAITING CHANNEL VALIDATION', 'WAITING FOR NFE EMISSION', 'CANCELLED', 'EMITTED'),
        allowNull: false,
        defaultValue: 'OPEN'
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 7. ORDER_HISTORIES
    await queryInterface.createTable('order_histories', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      step_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'steps', key: 'id' }
      },
      situation: { type: Sequelize.STRING(100), allowNull: false },
      date: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      json_data: { type: Sequelize.JSON, allowNull: true },
      result: {
        type: Sequelize.ENUM('success', 'errors', 'processing'),
        allowNull: false,
        defaultValue: 'processing'
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    // 8. ORDER_ITEMS (nova tabela)
    await queryInterface.createTable('order_items', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE'
      },
      name: { type: Sequelize.STRING(255), allowNull: false },
      sku: { type: Sequelize.STRING(100), allowNull: false },
      unit: { type: Sequelize.STRING(20), allowNull: true },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('order_items');
    await queryInterface.dropTable('order_histories');
    await queryInterface.dropTable('orders');
    await queryInterface.dropTable('stores');
    await queryInterface.dropTable('steps');
    await queryInterface.dropTable('customers');
    await queryInterface.dropTable('config_tokens');
    await queryInterface.dropTable('integrations');
  }
};