'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Remove campos redundantes
      await queryInterface.removeColumn('products', 'source_system',         { transaction });
      await queryInterface.removeColumn('products', 'external_id',           { transaction });
      await queryInterface.removeColumn('products', 'supplier_external_id',  { transaction });
      await queryInterface.removeColumn('products', 'supplier_contact_id',   { transaction });
      await queryInterface.removeColumn('products', 'supplier_name',         { transaction });
      await queryInterface.removeColumn('products', 'supplier_product_code', { transaction });

      // Adiciona FK supplier_id
      await queryInterface.addColumn(
        'products',
        'supplier_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'suppliers', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('products', 'supplier_id', { transaction });

      await queryInterface.addColumn('products', 'supplier_product_code', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_name',         { type: Sequelize.STRING(255), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_contact_id',   { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'supplier_external_id',  { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'external_id',           { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('products', 'source_system',         { type: Sequelize.STRING(50),  allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};