'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ── Remover colunas obsoletas ────────────────────────────────────────────
      await queryInterface.removeColumn('sales_order_item_snapshots', 'source_system',       { transaction });
      await queryInterface.removeColumn('sales_order_item_snapshots', 'external_item_id',    { transaction });
      await queryInterface.removeColumn('sales_order_item_snapshots', 'external_product_id', { transaction });

      // ── Adicionar coluna canônica ────────────────────────────────────────────
      await queryInterface.addColumn(
        'sales_order_item_snapshots',
        'integration_id',
        { type: Sequelize.UUID, allowNull: true },
        { transaction },
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
      // Remover coluna nova
      await queryInterface.removeColumn('sales_order_item_snapshots', 'integration_id', { transaction });

      // Restaurar colunas removidas
      await queryInterface.addColumn('sales_order_item_snapshots', 'source_system',       { type: Sequelize.STRING(50),  allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_item_snapshots', 'external_item_id',    { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_item_snapshots', 'external_product_id', { type: Sequelize.STRING(100), allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};