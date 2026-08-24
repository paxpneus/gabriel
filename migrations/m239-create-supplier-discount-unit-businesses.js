'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'supplier_discount_unit_businesses',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          supplier_discount_rule_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'supplier_discount_rules', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
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

      await queryInterface.addIndex(
        'supplier_discount_unit_businesses',
        ['supplier_discount_rule_id', 'unit_business_id'],
        {
          unique: true,
          name: 'uq_supplier_discount_unit_businesses_rule_unit_business',
          transaction,
        },
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
      await queryInterface.dropTable('supplier_discount_unit_businesses', {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
