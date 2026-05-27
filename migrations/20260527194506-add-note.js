

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('operations', 'note', {
       type: Sequelize.STRING(255),
                        allowNull: true,
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('operations', 'note')

  },
};