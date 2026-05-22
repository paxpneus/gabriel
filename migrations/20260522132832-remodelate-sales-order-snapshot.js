'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // ── Remover colunas obsoletas ────────────────────────────────────────────
      await queryInterface.removeColumn('sales_order_snapshots', 'source_system',          { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'external_order_id',      { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'external_order_number',  { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'external_invoice_id',    { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'status_id',              { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'status_name',            { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'status_value',           { transaction });

      // ── Adicionar colunas canônicas ──────────────────────────────────────────

      // Números do pedido copiados de orders (substitui external_order_*)
      await queryInterface.addColumn(
        'sales_order_snapshots',
        'order_number_system',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'sales_order_snapshots',
        'order_number_channel',
        { type: Sequelize.STRING(100), allowNull: true },
        { transaction },
      );

      // Status normalizado via integration_order_status_mappings (substitui status_id/name/value)
      await queryInterface.addColumn(
        'sales_order_snapshots',
        'status_snapshot',
        { type: Sequelize.STRING(100), allowNull: true },
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
      // Remover colunas novas
      await queryInterface.removeColumn('sales_order_snapshots', 'order_number_system',  { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'order_number_channel', { transaction });
      await queryInterface.removeColumn('sales_order_snapshots', 'status_snapshot',      { transaction });

      // Restaurar colunas removidas
      await queryInterface.addColumn('sales_order_snapshots', 'source_system',         { type: Sequelize.STRING(50),  allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'external_order_id',     { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'external_order_number', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'external_invoice_id',   { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'status_id',             { type: Sequelize.STRING(50),  allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'status_name',           { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.addColumn('sales_order_snapshots', 'status_value',          { type: Sequelize.STRING(50),  allowNull: true }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};