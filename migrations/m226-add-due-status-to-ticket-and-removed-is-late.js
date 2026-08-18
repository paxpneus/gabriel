'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Adicionar o enum e o campo due_status
    await queryInterface.addColumn('tickets', 'due_status', {
      type: Sequelize.ENUM('ON_TRACK', 'SOON', 'LATE'),
      allowNull: false,
      defaultValue: 'ON_TRACK',
    });

    // 2. Remover o campo antigo is_late
    await queryInterface.removeColumn('tickets', 'is_late');

    // 3. Alterar colunas para permitirem NULL via Sequelize literal
    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
        ALTER COLUMN description DROP NOT NULL,
        ALTER COLUMN area_id DROP NOT NULL,
        ALTER COLUMN priority_id DROP NOT NULL,
        ALTER COLUMN status_id DROP NOT NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    // 1. Reverter colunas para NOT NULL
    await queryInterface.sequelize.query(`
      ALTER TABLE tickets
        ALTER COLUMN description SET NOT NULL,
        ALTER COLUMN area_id SET NOT NULL,
        ALTER COLUMN priority_id SET NOT NULL,
        ALTER COLUMN status_id SET NOT NULL;
    `);

    // 2. Reestabelecer a coluna is_late
    await queryInterface.addColumn('tickets', 'is_late', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // 3. Remover o campo due_status e o tipo ENUM associado
    await queryInterface.removeColumn('tickets', 'due_status');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tickets_due_status";');
  },
};