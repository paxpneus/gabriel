'use strict';

module.exports = {
  async up(queryInterface) {
    // Remove a coluna unit_business_id da tabela stocks se existir
    try {
      await queryInterface.removeColumn('stocks', 'unit_business_id');
      console.log('Coluna unit_business_id removida de stocks');
    } catch (error) {
      console.log('Coluna unit_business_id já não existe em stocks ou erro ao remover:', error.message);
    }
  },

  async down(queryInterface) {
    // Nada a fazer no down
  },
};
