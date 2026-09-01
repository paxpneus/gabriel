'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('operation_comments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      unit_business_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'unit_businesses',
          key: 'id',
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      operation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'operations',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      point_to: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'operation_comments',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
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

    // Create indexes
    await queryInterface.addIndex('operation_comments', ['operation_id']);
    await queryInterface.addIndex('operation_comments', ['user_id']);
    await queryInterface.addIndex('operation_comments', ['unit_business_id']);
    await queryInterface.addIndex('operation_comments', ['point_to']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('operation_comments');
  },
};
