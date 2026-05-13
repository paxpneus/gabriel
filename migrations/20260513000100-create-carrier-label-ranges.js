'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'carrier_label_ranges',
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
          cep_start: {
            type: Sequelize.STRING(8),
            allowNull: false,
          },
          cep_end: {
            type: Sequelize.STRING(8),
            allowNull: false,
          },
          route_acronym: {
            type: Sequelize.STRING(100),
            allowNull: false,
          },
          service_name: {
            type: Sequelize.STRING(255),
            allowNull: true,
          },
          route_code: {
            type: Sequelize.STRING(100),
            allowNull: true,
          },
          transporter_code: {
            type: Sequelize.STRING(100),
            allowNull: false,
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
      await queryInterface.dropTable('carrier_label_ranges', { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
