'use strict';

const { randomUUID } = require('crypto');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'user_config',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.UUIDV4,
            primaryKey: true,
            allowNull: false,
          },
          user_id: {
            type: Sequelize.UUID,
            allowNull: false,
            unique: true,
            references: {
              model: 'users',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          theme: {
            type: Sequelize.ENUM('dark', 'light'),
            allowNull: false,
            defaultValue: 'light',
          },
          profile_photo: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          language: {
            type: Sequelize.STRING(10),
            allowNull: false,
            defaultValue: 'pt-BR',
          },
          timezone: {
            type: Sequelize.STRING(100),
            allowNull: false,
            defaultValue: 'America/Sao_Paulo',
          },
          items_per_page: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 20,
          },
          notifications_enabled: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          compact_mode: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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

      const [users] = await queryInterface.sequelize.query(
        'SELECT id FROM users',
        { transaction },
      );

      if (users.length > 0) {
        const now = new Date();
        await queryInterface.bulkInsert(
          'user_config',
          users.map((user) => ({
            id: randomUUID(),
            user_id: user.id,
            theme: 'light',
            language: 'pt-BR',
            timezone: 'America/Sao_Paulo',
            items_per_page: 20,
            notifications_enabled: true,
            compact_mode: false,
            created_at: now,
            updated_at: now,
          })),
          { transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.dropTable('user_config', { transaction });
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_user_config_theme";',
        { transaction },
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
