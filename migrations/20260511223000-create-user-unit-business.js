'use strict';

const { randomUUID } = require('crypto');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'user_unit_business',
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
            references: {
              model: 'users',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          unit_business_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'unit_businesses',
              key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
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

      await queryInterface.addConstraint('user_unit_business', {
        fields: ['user_id', 'unit_business_id'],
        type: 'unique',
        name: 'user_unit_business_user_id_unit_business_id_key',
        transaction,
      });

      const [users] = await queryInterface.sequelize.query(
        'SELECT id, unit_business_id FROM users WHERE unit_business_id IS NOT NULL',
        { transaction },
      );

      if (users.length > 0) {
        const now = new Date();
        await queryInterface.bulkInsert(
          'user_unit_business',
          users.map((user) => ({
            id: randomUUID(),
            user_id: user.id,
            unit_business_id: user.unit_business_id,
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
      await queryInterface.dropTable('user_unit_business', { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
