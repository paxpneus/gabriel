'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('tickets', 'due_date', {
    type: Sequelize.DATE,
    allowNull: true,
  }),
  down: queryInterface => queryInterface.removeColumn('tickets', 'due_date'),
};
