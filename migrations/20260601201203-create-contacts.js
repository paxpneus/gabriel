"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        "contacts",
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          type: {
            type: Sequelize.ENUM("SELLER", "CUSTOMER"),
            allowNull: false,
          },
          id_system: {
            type: Sequelize.STRING(100),
            allowNull: false,
          },
          integrations_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "integrations",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
              model: "unit_businesses",
              key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
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

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable("contacts", { transaction });
      await queryInterface.sequelize.query("DROP TYPE IF EXISTS enum_contacts_type;", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
