'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'inventory_subgroups',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          inventory_batch_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'inventory_batches',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          subgroup_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'subgroups',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
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
        { transaction },
      );

      await queryInterface.addIndex('inventory_subgroups', ['inventory_batch_id'], {
        name: 'idx_inventory_subgroups_inventory_batch_id',
        transaction,
      });
      await queryInterface.addIndex('inventory_subgroups', ['subgroup_id'], {
        name: 'idx_inventory_subgroups_subgroup_id',
        transaction,
      });
      await queryInterface.addIndex(
        'inventory_subgroups',
        ['inventory_batch_id', 'subgroup_id'],
        {
          name: 'idx_inventory_subgroups_batch_subgroup_unique',
          unique: true,
          transaction,
        },
      );

      await queryInterface.addColumn(
        'products',
        'subgroup_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'subgroups',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction },
      );

      await queryInterface.addIndex('products', ['subgroup_id'], {
        name: 'idx_products_subgroup_id',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeIndex('products', 'idx_products_subgroup_id', {
        transaction,
      });
      await queryInterface.removeColumn('products', 'subgroup_id', {
        transaction,
      });
      await queryInterface.dropTable('inventory_subgroups', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
