

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('operations', 'receiver_confirmation', {
       type: Sequelize.BOOLEAN,
                        defaultValue: false,
    });

    await queryInterface.addColumn('operations', 'sender_confirmation', {
      type: Sequelize.BOOLEAN,
                        defaultValue: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('operations', 'receiver_confirmation')

    await queryInterface.removeColumn('operations', 'sender_confirmation')
  },
};