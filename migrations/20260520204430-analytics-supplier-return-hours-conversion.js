"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // =========================================================
    // invoice_operation_snapshots
    // =========================================================

    await queryInterface.renameColumn(
      "invoice_operation_snapshots",
      "minutes_emission_to_delivery_note",
      "hours_emission_to_delivery_note",
    );

    await queryInterface.renameColumn(
      "invoice_operation_snapshots",
      "minutes_batch_to_fully_scanned",
      "hours_batch_to_fully_scanned",
    );

    await queryInterface.addColumn(
      "invoice_operation_snapshots",
      "is_supplier_return",
      {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    );

    // =========================================================
    // daily_operation_facts
    // =========================================================

    const minuteToHourColumns = [
      ["outgoing_perf_avg_minutes", "outgoing_perf_avg_hours"],
      ["outgoing_perf_min_minutes", "outgoing_perf_min_hours"],
      ["outgoing_perf_max_minutes", "outgoing_perf_max_hours"],
      ["incoming_perf_avg_minutes", "incoming_perf_avg_hours"],
      ["incoming_perf_min_minutes", "incoming_perf_min_hours"],
      ["incoming_perf_max_minutes", "incoming_perf_max_hours"],
    ];

    for (const [from, to] of minuteToHourColumns) {
      await queryInterface.renameColumn("daily_operation_facts", from, to);
    }

    await queryInterface.addColumn(
      "daily_operation_facts",
      "supplier_return_count",
      {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    );
  },

  async down(queryInterface, Sequelize) {
    // =========================================================
    // daily_operation_facts
    // =========================================================

    await queryInterface.removeColumn(
      "daily_operation_facts",
      "supplier_return_count",
    );

    const hourToMinuteColumns = [
      ["outgoing_perf_avg_hours", "outgoing_perf_avg_minutes"],
      ["outgoing_perf_min_hours", "outgoing_perf_min_minutes"],
      ["outgoing_perf_max_hours", "outgoing_perf_max_minutes"],
      ["incoming_perf_avg_hours", "incoming_perf_avg_minutes"],
      ["incoming_perf_min_hours", "incoming_perf_min_minutes"],
      ["incoming_perf_max_hours", "incoming_perf_max_minutes"],
    ];

    for (const [from, to] of hourToMinuteColumns) {
      await queryInterface.renameColumn("daily_operation_facts", from, to);
    }

    // =========================================================
    // invoice_operation_snapshots
    // =========================================================

    await queryInterface.removeColumn(
      "invoice_operation_snapshots",
      "is_supplier_return",
    );

    await queryInterface.renameColumn(
      "invoice_operation_snapshots",
      "hours_emission_to_delivery_note",
      "minutes_emission_to_delivery_note",
    );

    await queryInterface.renameColumn(
      "invoice_operation_snapshots",
      "hours_batch_to_fully_scanned",
      "minutes_batch_to_fully_scanned",
    );
  },
};