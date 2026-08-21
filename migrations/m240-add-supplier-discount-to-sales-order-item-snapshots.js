'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'sales_order_item_snapshots',
        'supplier_discount_value',
        {
          type: Sequelize.DECIMAL(14, 2),
          allowNull: false,
          defaultValue: 0,
        },
        { transaction },
      );

      await queryInterface.addColumn(
        'sales_order_item_snapshots',
        'supplier_discount_rule_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'supplier_discount_rules', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn(
        'sales_order_item_snapshots',
        'supplier_discount_rule_id',
        { transaction },
      );
      await queryInterface.removeColumn(
        'sales_order_item_snapshots',
        'supplier_discount_value',
        { transaction },
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
