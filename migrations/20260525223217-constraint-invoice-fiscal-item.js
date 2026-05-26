module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint("invoice_fiscal_items", {
      fields: ["invoice_id", "item_number"],
      type: "unique",
      name: "invoice_fiscal_items_invoice_id_item_number_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint(
      "invoice_fiscal_items",
      "invoice_fiscal_items_invoice_id_item_number_unique",
    );
  },
};