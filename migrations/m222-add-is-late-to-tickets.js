'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('tickets', 'is_late', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  }),
  down: queryInterface => queryInterface.removeColumn('tickets', 'is_late'),
};
