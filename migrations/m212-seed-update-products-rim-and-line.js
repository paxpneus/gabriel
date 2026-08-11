'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Extrai o aro (rim) a partir do measure, ex: 255/35R18 -> rim = 18
      // Pega o(s) dígito(s) que vêm logo depois do "R" no measure.
      await queryInterface.sequelize.query(
        `
        UPDATE products
        SET rim = SUBSTRING(measure FROM 'R([0-9]+)')
        WHERE
          measure IS NOT NULL
          AND measure ~ 'R[0-9]+'
          AND rim IS NULL;
        `,
        { transaction },
      );

      // Remove o índice de carga + índice de velocidade do início do line,
      // ex: "94Y XL FR CONTINENTALSPORT CONTACT 5P MO" -> "XL FR CONTINENTALSPORT CONTACT 5P MO"
      // Padrão: 2 ou 3 dígitos seguidos de 1 ou 2 letras, seguido de espaço, no início da string.
      await queryInterface.sequelize.query(
        `
        UPDATE products
        SET line = TRIM(REGEXP_REPLACE(line, '^[0-9]{2,3}[A-Za-z]{1,2}\\s+', ''))
        WHERE
          line IS NOT NULL
          AND line ~ '^[0-9]{2,3}[A-Za-z]{1,2}\\s+';
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Reverte o rim preenchido por este seed.
      // Obs: não é possível reverter com precisão o line original, pois o
      // índice de carga/velocidade removido não fica armazenado em lugar
      // nenhum. O down aqui só zera o rim.
      await queryInterface.sequelize.query(
        `
        UPDATE products
        SET rim = NULL
        WHERE measure ~ 'R[0-9]+';
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};