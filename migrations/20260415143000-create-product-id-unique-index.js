'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const transaction = await queryInterface.sequelize.transaction();

        try {
            // Drop the old composite unique constraint if it exists
            try {
                await queryInterface.sequelize.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE constraint_name = 'stocks_unit_business_id_product_id_unique'
    ) THEN
      ALTER TABLE stocks
      DROP CONSTRAINT stocks_unit_business_id_product_id_unique;
    END IF;
  END $$;
`);
            } catch (err) {
                // Constraint might not exist, that's okay
            }

            // Update product_id column to be unique
            await queryInterface.changeColumn('stocks', 'product_id', {
                type: Sequelize.UUID,
                allowNull: false,
                unique: true,
                references: {
                    model: 'products',
                    key: 'id',
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            }, { transaction });

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    },

    down: async (queryInterface, Sequelize) => {
        const transaction = await queryInterface.sequelize.transaction();
        try {
            // Remove the unique constraint by changing column back
            await queryInterface.changeColumn('stocks', 'product_id', {
                type: Sequelize.UUID,
                allowNull: false,
                unique: false,
                references: {
                    model: 'products',
                    key: 'id',
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            }, { transaction });


            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
};
