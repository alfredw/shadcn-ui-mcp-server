/**
 * Database Manager Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { rm } from 'fs/promises';
import path from 'path';
import os from 'os';

describe('PGLiteManager', () => {
  let manager: PGLiteManager;
  const testDbPath = path.join(os.tmpdir(), 'test-shadcn-mcp.db');

  beforeAll(async () => {
    // Clean up any existing test database
    await rm(testDbPath, { force: true, recursive: true });
  });

  afterAll(async () => {
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
    expect(isHealthy).toBe(true);
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
    expect(tableNames).toContain('components');
    expect(tableNames).toContain('blocks');
    expect(tableNames).toContain('schema_migrations');
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
    expect(isHealthy).toBe(true);
    
    await manager2.close();
  });

  it('should get database statistics', async () => {
    const stats = await manager.getStats();
    
    expect(stats).toBeTruthy();
    expect(stats.dbPath).toBe(testDbPath);
    expect(stats.size).toBeGreaterThanOrEqual(0);
    expect(stats.isHealthy).toBe(true);
    expect(stats.componentCount).toBe(0);
    expect(stats.blockCount).toBe(0);
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
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('test-component');
  });

  it('should handle errors gracefully', async () => {
    const invalidManager = new PGLiteManager({ 
      path: '/invalid/path/that/does/not/exist/db.sqlite' 
    });
    
    await expect(
      invalidManager.initialize()
    ).rejects.toThrow(/Failed to create database directory/);
  });
});