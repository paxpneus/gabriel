'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('contacts', 'user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addConstraint('contacts', {
      fields: ['user_id'],
      type: 'unique',
      name: 'contacts_user_id_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint(
      'contacts',
      'contacts_user_id_unique'
    );

    await queryInterface.removeColumn('contacts', 'user_id');
  }
};