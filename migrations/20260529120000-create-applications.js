'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('applications', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      role_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'roles',
          key: 'id',
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      api_key: {
        type: Sequelize.STRING(80),
        allowNull: false,
        unique: true,
      },
      api_secret_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      allowed_routes: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: false,
        defaultValue: [],
      },
      rate_limit_max_requests: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 120,
      },
      rate_limit_window_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 60,
      },
      token_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_login_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('applications', ['api_key'], {
      unique: true,
      name: 'applications_api_key_unique',
    });
    await queryInterface.addIndex('applications', ['role_id']);
    await queryInterface.addIndex('applications', ['is_active']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('applications');
  },
};

