/**
 * Database Migrations Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { MigrationRunner } from '../../../build/storage/database/migrations.js';
import { rm, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('MigrationRunner', () => {
  let manager: PGLiteManager;
  let runner: MigrationRunner;
  const testDbPath = path.join(os.tmpdir(), 'test-migrations.db');
  const testMigrationsPath = path.join(__dirname, 'test-migrations');

  beforeAll(async () => {
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

  afterAll(async () => {
    if (manager) {
      await manager.close();
    }
    await rm(testDbPath, { force: true, recursive: true });
    await rm(testMigrationsPath, { force: true, recursive: true });
  });

  it('should get current version', async () => {
    const version = await runner.getCurrentVersion();
    expect(version).toBe(0);
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
    expect(version).toBe(3);
    
    // Check if table was created
    const db = await manager.getConnection();
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'test_table'
    `);
    expect(result.rows).toHaveLength(1);
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
    expect(version).toBe(0);
    
    // Check if table was dropped
    const db = await manager.getConnection();
    const result = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'test_table'
    `);
    expect(result.rows).toHaveLength(0);
  });

  it('should handle migration errors', async () => {
    const invalidMigration = {
      version: 4,
      name: 'invalid_migration',
      up: 'INVALID SQL SYNTAX HERE;',
      down: ''
    };
    
    await expect(
      runner.applyMigration(invalidMigration)
    ).rejects.toThrow(/syntax error/);
    
    // Version should not change
    const version = await runner.getCurrentVersion();
    expect(version).toBe(0);
  });
});