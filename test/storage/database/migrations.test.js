import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { MigrationRunner } from '../../../build/storage/database/migrations.js';
import { rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('MigrationRunner', () => {
  let manager;
  let runner;
  const testDbPath = path.join(os.tmpdir(), 'test-migrations.db');
  const testMigrationsPath = path.join(__dirname, 'test-migrations');

  before(async () => {
    // Clean up any existing test database
    await rm(testDbPath, { force: true, recursive: true });
    await rm(testMigrationsPath, { force: true, recursive: true });
    
    // Create test migrations directory
    await mkdir(testMigrationsPath, { recursive: true });
    
    // Initialize database
    manager = new PGLiteManager({ path: testDbPath });
    await manager.initialize();
    
    const db = await manager.getConnection();
    runner = new MigrationRunner(db);
  });

  after(async () => {
    if (manager) {
      await manager.close();
    }
    await rm(testDbPath, { force: true, recursive: true });
    await rm(testMigrationsPath, { force: true, recursive: true });
  });

  it('should get current version', async () => {
    const version = await runner.getCurrentVersion();
    assert.strictEqual(version, 0, 'Initial version should be 0');
  });

  it('should load and apply migrations', async () => {
    // Create a test migration
    const migration = {
      version: 3,
      name: 'test_migration',
      up: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);',
      down: 'DROP TABLE test_table;'
    };
    
    await runner.applyMigration(migration);
    
    const version = await runner.getCurrentVersion();
    assert.strictEqual(version, 3, 'Version should be updated to 3');
    
    // Check if table was created
    const db = await manager.getConnection();
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'test_table'
    `);
    assert.strictEqual(result.rows.length, 1, 'Test table should exist');
  });

  it('should rollback migrations', async () => {
    const migration = {
      version: 3,
      name: 'test_migration',
      up: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);',
      down: 'DROP TABLE test_table;'
    };
    
    await runner.rollbackMigration(migration);
    
    const version = await runner.getCurrentVersion();
    assert.strictEqual(version, 0, 'Version should be back to 0');
    
    // Check if table was dropped
    const db = await manager.getConnection();
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'test_table'
    `);
    assert.strictEqual(result.rows.length, 0, 'Test table should not exist');
  });

  it('should handle migration errors', async () => {
    const invalidMigration = {
      version: 4,
      name: 'invalid_migration',
      up: 'INVALID SQL SYNTAX HERE;',
      down: ''
    };
    
    await assert.rejects(
      async () => await runner.applyMigration(invalidMigration),
      /syntax error/,
      'Should throw error for invalid SQL'
    );
    
    // Version should not change
    const version = await runner.getCurrentVersion();
    assert.strictEqual(version, 0, 'Version should remain 0 after failed migration');
  });
});