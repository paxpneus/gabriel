'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('temp_files', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      buffer: {
        type: Sequelize.BLOB,
        allowNull: false,
      },
      mime_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      original_filename: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      upload_directory: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      preserve_filename: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Associação polimórfica sem FK (mesma decisão de integration_mappings.internal_id).
      entity_type: {
        type: Sequelize.ENUM('PDV_SALES_REQUEST_RECEIPT', 'UNMAPPED_INVOICE_PRODUCT'),
        allowNull: true,
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      // Contador do sweep de reconciliação (ver UploaderQueue.processReconcile).
      reconcile_attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('temp_files');
  },
};
