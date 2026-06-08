'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_configs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      product_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'products',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      sku: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      price: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      supplier_cost_price: {
        type: Sequelize.DECIMAL(14, 4),
        allowNull: true,
      },
      supplier_purchase_price: {
        type: Sequelize.DECIMAL(14, 4),
        allowNull: true,
      },
      average_cost: {
        type: Sequelize.DECIMAL(14, 4),
        allowNull: true,
      },
      average_cost_updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ncm: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      cest: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      gtin: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      gtin_package: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addConstraint('product_configs', {
      fields: ['product_id', 'unit_business_id'],
      type: 'unique',
      name: 'uq_product_config_product_unit_business',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_configs');
  },
};
