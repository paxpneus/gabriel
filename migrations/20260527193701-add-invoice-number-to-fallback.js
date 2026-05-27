

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('operations', 'invoice_number', {
       type: Sequelize.STRING(255),
                        allowNull: true,
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('operations', 'invoice_number')

  },
};