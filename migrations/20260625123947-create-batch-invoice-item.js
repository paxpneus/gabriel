'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('batch_invoice_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      expedition_batch_item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'expedition_batch_items',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      expedition_batch_invoice_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'expedition_batch_invoices',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      quantity_expected: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      quantity_received: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0,
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'FINISHED'),
        allowNull: false,
        defaultValue: 'PENDING',
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

    // Índice para evitar duplicatas: um batch_invoice_item por combinação de invoice + batch_item
    await queryInterface.addIndex('batch_invoice_items', ['expedition_batch_invoice_id', 'expedition_batch_item_id'], {
      unique: true,
      name: 'uq_batch_invoice_items_invoice_item',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('batch_invoice_items');
  },
};