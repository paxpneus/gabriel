'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // xml_path guarda o XML inteiro (criptografado via encryptXml), que
    // facilmente ultrapassa 255 caracteres. A coluna foi criada como
    // VARCHAR(255) por engano — precisa ser TEXT (sem limite prático).
    await queryInterface.changeColumn('ctes', 'xml_path', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ctes', 'xml_path', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },
};