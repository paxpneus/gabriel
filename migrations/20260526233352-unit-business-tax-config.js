// XXXXXXXXXXXXXX-create-unit-business-tax-configs.js

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('unit_business_tax_configs', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
      },
      unit_business_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'unit_businesses', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      approx_tax_rate: {
        type: Sequelize.DECIMAL(5, 4),
        allowNull: false,
        defaultValue: 0,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // já insere a Loja Pax Meli, se ela existir neste banco
    await queryInterface.sequelize.query(`
      INSERT INTO unit_business_tax_configs
        (id, unit_business_id, approx_tax_rate, description, created_at, updated_at)
      SELECT :id, id, 0.0830, 'Taxa fiscal estimada Loja Pax Meli (Mercado Livre)', now(), now()
      FROM unit_businesses
      WHERE id = :unitBusinessId
    `, {
      replacements: {
        id: require('uuid').v4(),
        unitBusinessId: '2d4a638e-1738-48c5-ac8b-d6c120ffa2e5',
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('unit_business_tax_configs');
  },
};