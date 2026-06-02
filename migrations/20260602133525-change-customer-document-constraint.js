'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Remover constraint UNIQUE do document
    try {
      await queryInterface.removeConstraint('customers', 'customers_document_key');
    } catch (error) {
      console.log('Constraint customers_document_key não encontrada, tentando outro nome...');
      try {
        await queryInterface.removeConstraint('customers', 'document');
      } catch (e) {
        console.log('Nenhuma constraint UNIQUE encontrada para remover');
      }
    }

    // Alterar o campo document para permitir NULL
    await queryInterface.changeColumn('customers', 'document', {
      type: Sequelize.STRING(14),
      allowNull: true,
      unique: true
    });
  },

  async down (queryInterface, Sequelize) {
    // Reverter: remover allowNull
    await queryInterface.changeColumn('customers', 'document', {
      type: Sequelize.STRING(14),
      allowNull: false,
      unique: true
    });

    // Adicionar constraint UNIQUE novamente
    await queryInterface.addConstraint('customers', {
      fields: ['document'],
      type: 'unique',
      name: 'customers_document_key'
    });
  }
};
