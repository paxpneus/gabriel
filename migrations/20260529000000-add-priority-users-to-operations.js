'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'operations',
        'priority_level',
        {
          type: Sequelize.ENUM('URGENT', 'HIGH', 'REGULAR', 'LOW'),
          allowNull: true,
        },
        { transaction },
      );

      await queryInterface.addColumn(
        'operations',
        'justification_priority_level',
        {
          type: Sequelize.STRING(255),
          allowNull: true,
        },
        { transaction },
      );

      await queryInterface.addColumn(
        'operations',
        'request_user',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction },
      );

      await queryInterface.addColumn(
        'operations',
        'receiver_user',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        { transaction },
      );

      await queryInterface.addIndex('operations', ['priority_level'], {
        name: 'idx_operations_priority_level',
        transaction,
      });
      await queryInterface.addIndex('operations', ['request_user'], {
        name: 'idx_operations_request_user',
        transaction,
      });
      await queryInterface.addIndex('operations', ['receiver_user'], {
        name: 'idx_operations_receiver_user',
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeIndex('operations', 'idx_operations_receiver_user', {
        transaction,
      });
      await queryInterface.removeIndex('operations', 'idx_operations_request_user', {
        transaction,
      });
      await queryInterface.removeIndex('operations', 'idx_operations_priority_level', {
        transaction,
      });

      await queryInterface.removeColumn('operations', 'receiver_user', { transaction });
      await queryInterface.removeColumn('operations', 'request_user', { transaction });
      await queryInterface.removeColumn('operations', 'justification_priority_level', {
        transaction,
      });
      await queryInterface.removeColumn('operations', 'priority_level', { transaction });

      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_operations_priority_level";',
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
