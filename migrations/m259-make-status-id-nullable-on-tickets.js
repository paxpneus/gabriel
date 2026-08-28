'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      DROP CONSTRAINT IF EXISTS tickets_status_id_fkey;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      ALTER COLUMN status_id DROP NOT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      ADD CONSTRAINT tickets_status_id_fkey
      FOREIGN KEY (status_id) REFERENCES ticket_statuses (id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      DROP CONSTRAINT IF EXISTS tickets_status_id_fkey;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      ALTER COLUMN status_id SET NOT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
      ADD CONSTRAINT tickets_status_id_fkey
      FOREIGN KEY (status_id) REFERENCES ticket_statuses (id)
      ON UPDATE CASCADE ON DELETE RESTRICT;
    `);
  },
};
