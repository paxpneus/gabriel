'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('unmapped_invoice_products', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.UUIDV4,
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
      ean: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      sku: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      product_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      reason: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('UNMAPPED', 'MAPPED'),
        allowNull: false,
        defaultValue: 'UNMAPPED',
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

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX uq_unmapped_invoice_products_invoice_ean_sku
        ON unmapped_invoice_products (invoice_id, COALESCE(ean, ''), COALESCE(sku, ''));
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS uq_unmapped_invoice_products_invoice_ean_sku;'
    );

    await queryInterface.dropTable('unmapped_invoice_products');

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_unmapped_invoice_products_status";'
    );
  },
};