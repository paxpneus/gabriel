'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('invoice_unit_business_attributes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      unit_business_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'unit_businesses',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      invoice_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'invoices',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('INCOMING', 'OUTGOING'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(
          'OPEN',
          'PENDING',
          'FINISHED',
          'FREE_TO_SCHEDULE',
          'WAITING_SCHEDULE_SALES',
          'SCHEDULED',
          'LATE',
          'CANCELLED',
          'PENDING_CANCELLED_SYSTEM',
        ),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      batch_generated: {
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
    });

    // Unique composto: uma unit_business não pode se repetir na mesma invoice
    await queryInterface.addIndex('invoice_unit_business_attributes', ['invoice_id', 'unit_business_id'], {
      unique: true,
      name: 'uq_invoice_unit_business_attributes_invoice_unit_business',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('invoice_unit_business_attributes');
  },
};