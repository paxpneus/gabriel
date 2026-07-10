'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'groups',
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
            type: Sequelize.ENUM('PRODUCTS'),
            allowNull: false,
            defaultValue: 'PRODUCTS',
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

      await queryInterface.createTable(
        'subgroups',
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
          group_id: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: 'groups',
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

      await queryInterface.addIndex('groups', ['type'], {
        name: 'idx_groups_type',
        transaction,
      });
      await queryInterface.addIndex('groups', ['name', 'type'], {
        name: 'idx_groups_name_type_unique',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex('subgroups', ['group_id'], {
        name: 'idx_subgroups_group_id',
        transaction,
      });
      await queryInterface.addIndex('subgroups', ['group_id', 'name'], {
        name: 'idx_subgroups_group_id_name_unique',
        unique: true,
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
      await queryInterface.dropTable('subgroups', { transaction });
      await queryInterface.dropTable('groups', { transaction });
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_groups_type";', {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
