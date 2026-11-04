'use strict';

// Gerente regional: contato SELLER_MANAGER com grupo de lojas; ganha a comissão de gerente de todas as lojas do grupo,
// além (não no lugar) da comissão do gerente de cada loja.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('contacts', 'unit_business_group_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'unit_business_groups', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('contacts', 'unit_business_group_id');
  },
};
