'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_payments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payment_method_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'payment_methods', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      id_system: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
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
    });

    await queryInterface.addIndex('order_payments', ['order_id']);
    await queryInterface.addIndex('order_payments', ['payment_method_id']);

    // Preserva o vínculo antigo (1 forma por pedido) como uma única linha.
    await queryInterface.sequelize.query(`
      INSERT INTO order_payments (id, order_id, payment_method_id, amount, created_at, updated_at)
      SELECT gen_random_uuid(), id, payment_method_id, COALESCE(net_total_order, total_order, 0), NOW(), NOW()
      FROM orders
      WHERE payment_method_id IS NOT NULL
    `);

    await queryInterface.removeColumn('orders', 'payment_method_id');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'payment_method_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'payment_methods', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // Volta com a forma de maior valor de cada pedido.
    await queryInterface.sequelize.query(`
      UPDATE orders o SET payment_method_id = p.payment_method_id
      FROM (
        SELECT DISTINCT ON (order_id) order_id, payment_method_id
        FROM order_payments
        ORDER BY order_id, amount DESC
      ) p
      WHERE p.order_id = o.id
    `);

    await queryInterface.dropTable('order_payments');
  },
};
