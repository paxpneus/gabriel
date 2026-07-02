"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        "orders",
        "seller_id",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "contacts",
            key: "id",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
        },
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn("orders", "seller_id", {
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
