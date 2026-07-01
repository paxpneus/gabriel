
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE invoice_operation_snapshots
        DROP CONSTRAINT IF EXISTS invoice_operation_snapshots_invoice_id_key;
    `);

    await queryInterface.addConstraint("invoice_operation_snapshots", {
      fields: ["invoice_id", "unit_business_id"],
      type: "unique",
      name: "invoice_operation_snapshots_invoice_unit_business_key",
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeConstraint(
      "invoice_operation_snapshots",
      "invoice_operation_snapshots_invoice_unit_business_key",
    );

    await queryInterface.addConstraint("invoice_operation_snapshots", {
      fields: ["invoice_id"],
      type: "unique",
      name: "invoice_operation_snapshots_invoice_id_key",
    });
  },
};