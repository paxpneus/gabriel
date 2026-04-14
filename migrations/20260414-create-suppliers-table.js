'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // ─── SUPPLIERS ───────────────────────────────────────
      await queryInterface.createTable(
        'suppliers',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          document: {
            type: Sequelize.STRING(20),
            allowNull: false,
            unique: true,
          },
          fantasy_name: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          city: {
            type: Sequelize.STRING(100),
            allowNull: false,
          },
          uf: {
            type: Sequelize.STRING(2),
            allowNull: false,
          },
          id_system: {
            type: Sequelize.STRING(100),
            allowNull: true,
        
          },
          code: {
            type: Sequelize.STRING(100),
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
        },
        { transaction }
      );

      // ─── STOCK: remover unit_id ──────────────────────────
      await queryInterface.removeColumn('stocks', 'unit_business_id', { transaction });

      // ─── UNIT_BUSINESSES: adicionar id_system ────────────
      await queryInterface.addColumn(
        'unit_businesses',
        'id_system',
        {
          type: Sequelize.STRING(100),
          allowNull: true,
    
        },
        { transaction }
      );

      // ─── PRODUCTS: adicionar id_system ───────────────────
      await queryInterface.addColumn(
        'products',
        'id_system',
        {
          type: Sequelize.STRING(100),
          allowNull: true,
      
        },
        { transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // rollback PRODUCTS
      await queryInterface.removeColumn('products', 'id_system', { transaction });

      // rollback UNIT_BUSINESSES
      await queryInterface.removeColumn('unit_businesses', 'id_system', { transaction });

      // rollback STOCK (recria coluna)
      await queryInterface.addColumn(
        'stocks',
        'unit_business_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'unit_businesses',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction }
      );

      // rollback SUPPLIERS
      await queryInterface.dropTable('suppliers', { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};