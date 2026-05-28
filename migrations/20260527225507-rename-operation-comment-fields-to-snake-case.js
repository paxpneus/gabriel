'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'userId'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'user_id'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN "userId" TO user_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'unitBusinessId'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'unit_business_id'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN "unitBusinessId" TO unit_business_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'operationId'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'operation_id'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN "operationId" TO operation_id;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'pointTo'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'point_to'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN "pointTo" TO point_to;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'user_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'userId'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN user_id TO "userId";
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'unit_business_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'unitBusinessId'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN unit_business_id TO "unitBusinessId";
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'operation_id'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'operationId'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN operation_id TO "operationId";
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'point_to'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operation_comments' AND column_name = 'pointTo'
        ) THEN
          ALTER TABLE operation_comments RENAME COLUMN point_to TO "pointTo";
        END IF;
      END $$;
    `);
  },
};
