

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'line', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn('products', 'measure', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('products', 'line')

    await queryInterface.removeColumn('products', 'measure')
  },
};