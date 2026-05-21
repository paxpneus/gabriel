module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "daily_operation_facts",
      "invoices_outgoing_cancelled",
      { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false }
    );
    await queryInterface.addColumn(
      "daily_operation_facts",
      "invoices_outgoing_pending_cancelled",
      { type: Sequelize.INTEGER, defaultValue: 0, allowNull: false }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("daily_operation_facts", "invoices_outgoing_cancelled");
    await queryInterface.removeColumn("daily_operation_facts", "invoices_outgoing_pending_cancelled");
  },
};