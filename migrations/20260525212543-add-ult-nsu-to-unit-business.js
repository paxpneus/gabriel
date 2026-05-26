module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("unit_businesses", "ult_nsu", {
      type: Sequelize.STRING(15),
      allowNull: false,
      defaultValue: "000000000000000",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("unit_businesses", "ult_nsu");
  },
};