'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('contacts', 'document', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addIndex("contacts", ["document"], {
      name: "contacts_document_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("contacts", "contacts_document_idx");
    await queryInterface.removeColumn('contacts', 'document');
  },
};
