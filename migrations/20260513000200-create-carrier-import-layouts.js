'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'carrier_import_layouts',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          transporter_id: {
            type: Sequelize.UUID,
            allowNull: false,
            unique: true,
            references: {
              model: 'transporters',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          name: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          type: {
            type: Sequelize.ENUM('EXCEL', 'CSV'),
            allowNull: false,
            defaultValue: 'EXCEL',
          },
          sheet_name: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          data_start_row: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 2,
          },
          mapping_mode: {
            type: Sequelize.ENUM('HEADER', 'COLUMN'),
            allowNull: false,
            defaultValue: 'HEADER',
          },
          zip_from_label: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          zip_to_label: {
            type: Sequelize.STRING(255),
            allowNull: false,
          },
          route_code_label: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          destination_label: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          observation_label: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          metadata: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          active: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
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
      await queryInterface.dropTable('carrier_import_layouts', { transaction });
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_carrier_import_layouts_type";',
        { transaction },
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_carrier_import_layouts_mapping_mode";',
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
