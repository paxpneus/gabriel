import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve(__dirname, '../../../migrations');

const migrationName = process.argv.slice(2).join('-');

if (!migrationName) {
  console.error('Uso: npm run makemigrations -- nome-da-migration');
  process.exit(1);
}

if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true });
}

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter(file => /\.(ts|js)$/.test(file));

const nextNumber = migrationFiles.length + 1;

const migrationId = `m${String(nextNumber).padStart(3, '0')}`;

const fileName = `${migrationId}-${migrationName}.js`;

const filePath = path.join(migrationsDir, fileName);

const template = `'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
  }
};

`;

fs.writeFileSync(filePath, template);

console.log(`✅ Migration criada: ${fileName}`);