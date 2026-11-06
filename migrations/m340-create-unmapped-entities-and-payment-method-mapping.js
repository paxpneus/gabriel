'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Forma de pagamento da Bling (formaPagamento.id) → payment_methods via integration_mappings.
    await queryInterface.sequelize.query(
      `ALTER TYPE enum_integration_mappings_entity_type ADD VALUE IF NOT EXISTS 'PAYMENT_METHOD';`,
    );

    // Pendências genéricas: valor que a integração mandou e ainda não tem integration_mapping.
    await queryInterface.createTable('unmapped_entities', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      entity: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      external_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      integrations_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integrations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    // Uma pendência por valor da integração (sync repetido só atualiza a descrição).
    await queryInterface.addIndex(
      'unmapped_entities',
      ['entity', 'integrations_id', 'external_id'],
      { unique: true, name: 'uq_unmapped_entities_entity_integration_external' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('unmapped_entities');
    // Valor de enum não sai no Postgres; mappings PAYMENT_METHOD saem pra não sobrar órfão.
    await queryInterface.sequelize.query(
      `DELETE FROM integration_mappings WHERE entity_type = 'PAYMENT_METHOD';`,
    );
  },
};
