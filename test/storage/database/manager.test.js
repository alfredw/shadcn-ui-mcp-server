import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { rm } from 'fs/promises';
import path from 'path';
import os from 'os';

describe('PGLiteManager', () => {
  let manager;
  const testDbPath = path.join(os.tmpdir(), 'test-shadcn-mcp.db');

  before(async () => {
    // Clean up any existing test database
    await rm(testDbPath, { force: true, recursive: true });
  });

  after(async () => {
    // Clean up after tests
    if (manager) {
      await manager.close();
    }
    await rm(testDbPath, { force: true, recursive: true });
  });

  it('should initialize database successfully', async () => {
    manager = new PGLiteManager({ path: testDbPath });
    await manager.initialize();
    
    const isHealthy = await manager.checkHealth();
    assert.strictEqual(isHealthy, true, 'Database should be healthy after initialization');
  });

  it('should create initial schema', async () => {
    const db = await manager.getConnection();
    
    // Check if tables exist
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const tableNames = tablesResult.rows.map(row => row.table_name);
    assert.ok(tableNames.includes('components'), 'Components table should exist');
    assert.ok(tableNames.includes('blocks'), 'Blocks table should exist');
    assert.ok(tableNames.includes('schema_migrations'), 'Schema migrations table should exist');
  });

  it('should handle concurrent initialization attempts', async () => {
    const manager2 = new PGLiteManager({ path: testDbPath });
    
    // Start multiple initialization attempts concurrently
    const promises = [
      manager2.initialize(),
      manager2.initialize(),
      manager2.initialize()
    ];
    
    // All should resolve without error
    await Promise.all(promises);
    
    const isHealthy = await manager2.checkHealth();
    assert.strictEqual(isHealthy, true, 'Database should be healthy after concurrent initialization');
    
    await manager2.close();
  });

  it('should get database statistics', async () => {
    const stats = await manager.getStats();
    
    assert.ok(stats, 'Stats should be returned');
    assert.strictEqual(stats.dbPath, testDbPath, 'Database path should match');
    assert.ok(stats.size >= 0, 'Size should be non-negative');
    assert.strictEqual(stats.isHealthy, true, 'Database should be healthy');
    assert.strictEqual(stats.componentCount, 0, 'Component count should be 0 initially');
    assert.strictEqual(stats.blockCount, 0, 'Block count should be 0 initially');
  });

  it('should handle database operations', async () => {
    const db = await manager.getConnection();
    
    // Insert test data
    await db.query(`
      INSERT INTO components (framework, name, source_code)
      VALUES ($1, $2, $3)
    `, ['react', 'test-component', 'export default function Test() {}']);
    
    // Query data
    const result = await db.query('SELECT * FROM components WHERE name = $1', ['test-component']);
    assert.strictEqual(result.rows.length, 1, 'Should find inserted component');
    assert.strictEqual(result.rows[0].name, 'test-component', 'Component name should match');
  });

  it('should handle errors gracefully', async () => {
    const invalidManager = new PGLiteManager({ 
      path: '/invalid/path/that/does/not/exist/db.sqlite' 
    });
    
    await assert.rejects(
      async () => await invalidManager.initialize(),
      /Failed to create database directory/,
      'Should throw error for invalid path'
    );
  });
});