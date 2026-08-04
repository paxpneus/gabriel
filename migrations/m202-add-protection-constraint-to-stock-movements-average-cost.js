'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
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

      CREATE TRIGGER trigger_prevent_delete_manual_adjustment_with_cost
      BEFORE DELETE ON "stock_movements"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_delete_manual_adjustment_with_cost();
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS trigger_prevent_delete_manual_adjustment_with_cost 
      ON "stock_movements";

      DROP FUNCTION IF EXISTS prevent_delete_manual_adjustment_with_cost();
    `);
  },
};