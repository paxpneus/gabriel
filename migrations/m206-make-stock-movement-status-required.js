'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Registros anteriores à m203 não possuem status. Eles pertencem ao
    // fluxo normal do sistema e devem permanecer como pendentes.
    await queryInterface.sequelize.query(`
      UPDATE stock_movements
      SET status = 'PENDING'
      WHERE status IS NULL;
    `);

    await queryInterface.changeColumn('stock_movements', 'status', {
      type: Sequelize.ENUM('PENDING', 'SYNCHED'),
      allowNull: false,
      defaultValue: 'PENDING',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('stock_movements', 'status', {
      type: Sequelize.ENUM('PENDING', 'SYNCHED'),
      allowNull: true,
      defaultValue: null,
    });
  },
};
