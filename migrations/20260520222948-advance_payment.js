"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // =========================================================
    // invoice_operation_snapshots
    // =========================================================

    await queryInterface.addColumn(
      "invoice_operation_snapshots",
      "is_advance_payment",
      {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    );

    // =========================================================
    // daily_operation_facts
    // =========================================================

    await queryInterface.addColumn(
      "daily_operation_facts",
      "advance_payment_count",
      {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    );
  },

  async down(queryInterface, _Sequelize) {
    // =========================================================
    // daily_operation_facts
    // =========================================================

    await queryInterface.removeColumn(
      "daily_operation_facts",
      "advance_payment_count",
    );

    // =========================================================
    // invoice_operation_snapshots
    // =========================================================

    await queryInterface.removeColumn(
      "invoice_operation_snapshots",
      "is_advance_payment",
    );
  },
};