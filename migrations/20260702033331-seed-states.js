'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        INSERT INTO states (
          id,
          acronym,
          name,
          icms_rate,
          created_at,
          updated_at
        )
        VALUES
          (gen_random_uuid(), 'AC', 'Acre', 0, NOW(), NOW()),
          (gen_random_uuid(), 'AL', 'Alagoas', 0, NOW(), NOW()),
          (gen_random_uuid(), 'AP', 'Amapá', 0, NOW(), NOW()),
          (gen_random_uuid(), 'AM', 'Amazonas', 0, NOW(), NOW()),
          (gen_random_uuid(), 'BA', 'Bahia', 0, NOW(), NOW()),
          (gen_random_uuid(), 'CE', 'Ceará', 0, NOW(), NOW()),
          (gen_random_uuid(), 'DF', 'Distrito Federal', 0, NOW(), NOW()),
          (gen_random_uuid(), 'ES', 'Espírito Santo', 0, NOW(), NOW()),
          (gen_random_uuid(), 'GO', 'Goiás', 0, NOW(), NOW()),
          (gen_random_uuid(), 'MA', 'Maranhão', 0, NOW(), NOW()),
          (gen_random_uuid(), 'MT', 'Mato Grosso', 0, NOW(), NOW()),
          (gen_random_uuid(), 'MS', 'Mato Grosso do Sul', 0, NOW(), NOW()),
          (gen_random_uuid(), 'MG', 'Minas Gerais', 0, NOW(), NOW()),
          (gen_random_uuid(), 'PA', 'Pará', 0, NOW(), NOW()),
          (gen_random_uuid(), 'PB', 'Paraíba', 0, NOW(), NOW()),
          (gen_random_uuid(), 'PR', 'Paraná', 0, NOW(), NOW()),
          (gen_random_uuid(), 'PE', 'Pernambuco', 0, NOW(), NOW()),
          (gen_random_uuid(), 'PI', 'Piauí', 0, NOW(), NOW()),
          (gen_random_uuid(), 'RJ', 'Rio de Janeiro', 0, NOW(), NOW()),
          (gen_random_uuid(), 'RN', 'Rio Grande do Norte', 0, NOW(), NOW()),
          (gen_random_uuid(), 'RS', 'Rio Grande do Sul', 0, NOW(), NOW()),
          (gen_random_uuid(), 'RO', 'Rondônia', 0, NOW(), NOW()),
          (gen_random_uuid(), 'RR', 'Roraima', 0, NOW(), NOW()),
          (gen_random_uuid(), 'SC', 'Santa Catarina', 0, NOW(), NOW()),
          (gen_random_uuid(), 'SP', 'São Paulo', 0, NOW(), NOW()),
          (gen_random_uuid(), 'SE', 'Sergipe', 0, NOW(), NOW()),
          (gen_random_uuid(), 'TO', 'Tocantins', 0, NOW(), NOW())
        ON CONFLICT (acronym) DO NOTHING;
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.sequelize.query(
        `
        DELETE FROM states
        WHERE acronym IN (
          'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
          'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
          'RS','RO','RR','SC','SP','SE','TO'
        );
        `,
        { transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};