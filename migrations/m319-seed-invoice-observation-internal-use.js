'use strict';

const INTERNAL_USE_TEXT = 'Nota de uso e consumo';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // markAsInternalUse antigo gravava o texto na description; move pra observation (append, mesma regra do código).
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE invoices
       SET observation = CASE
             WHEN observation IS NULL OR observation = '' THEN description
             ELSE observation || E'\\n' || description
           END,
           description = NULL,
           updated_at = NOW()
       WHERE description = :text`,
      { replacements: { text: INTERNAL_USE_TEXT } },
    );
  },

  // Só desfaz as notas cuja observation é exatamente o texto movido.
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE invoices
       SET description = observation, observation = NULL, updated_at = NOW()
       WHERE observation = :text AND description IS NULL`,
      { replacements: { text: INTERNAL_USE_TEXT } },
    );
  },
};
