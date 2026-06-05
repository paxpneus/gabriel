'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const dropConstraintIfExists = async (name) => {
        await queryInterface.sequelize.query(
          `
          DO $$
          BEGIN
            IF EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE table_name = 'stocks'
                AND constraint_name = '${name}'
            ) THEN
              ALTER TABLE stocks DROP CONSTRAINT "${name}";
            END IF;
          END $$;
          `,
          { transaction },
        );
      };

      await dropConstraintIfExists('stocks_product_id_unique');
      await dropConstraintIfExists('stocks_unit_business_id_key');
      await dropConstraintIfExists('stocks_product_id_key');
      await dropConstraintIfExists('stocks_unit_business_id_product_id_unique');
      await dropConstraintIfExists('stocks_product_unit_business_unique');

      // Adiciona unit_business_id se não existir
      const [stockColumns] = await queryInterface.sequelize.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'stocks'
          AND column_name = 'unit_business_id'
        `,
        { transaction },
      );

      if (!stockColumns.length) {
        await queryInterface.addColumn(
          'stocks',
          'unit_business_id',
          {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'unit_businesses', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          { transaction },
        );
      }

      // Altera product_id via raw query para garantir remoção de unique
      await queryInterface.sequelize.query(
        `ALTER TABLE stocks ALTER COLUMN product_id SET NOT NULL;`,
        { transaction },
      );

      await queryInterface.addConstraint('stocks', {
        fields: ['product_id', 'unit_business_id'],
        type: 'unique',
        name: 'stocks_product_unit_business_unique',
        transaction,
      });

      // Adiciona integrations_id em unmapped_invoice_products se não existir
      const [unmappedColumns] = await queryInterface.sequelize.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'unmapped_invoice_products'
          AND column_name = 'integrations_id'
        `,
        { transaction },
      );

      if (!unmappedColumns.length) {
        await queryInterface.addColumn(
          'unmapped_invoice_products',
          'integrations_id',
          {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'integrations', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
          },
          { transaction },
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeConstraint(
        'stocks',
        'stocks_product_unit_business_unique',
        { transaction },
      );

      // Recria unique em product_id via raw query
      await queryInterface.sequelize.query(
        `ALTER TABLE stocks ADD CONSTRAINT stocks_product_id_key UNIQUE (product_id);`,
        { transaction },
      );

      await queryInterface.removeColumn('stocks', 'unit_business_id', { transaction });

      await queryInterface.removeColumn('unmapped_invoice_products', 'integrations_id', {
        transaction,
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};