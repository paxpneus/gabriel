'use strict';

// Atualiza o trigger criado em m202: a proteção contra DELETE de um
// MANUAL_ADJUSTMENT deixa de ser baseada em manual_average_cost_value
// preenchido e passa a ser baseada em refers_to preenchido (a âncora
// explícita pra nota fiscal que o ajuste corrige).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION prevent_delete_manual_adjustment_with_cost()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.movement_type = 'MANUAL_ADJUSTMENT'
           AND OLD.refers_to IS NOT NULL THEN
          RAISE EXCEPTION
            'Não é permitido excluir MANUAL_ADJUSTMENT com refers_to preenchido';
        END IF;

        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION prevent_delete_manual_adjustment_with_cost()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.movement_type = 'MANUAL_ADJUSTMENT'
           AND OLD.manual_average_cost_value IS NOT NULL THEN
          RAISE EXCEPTION
            'Não é permitido excluir MANUAL_ADJUSTMENT com manual_average_cost_value preenchido';
        END IF;

        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
  },
};
