import { PGlite } from '@electric-sql/pglite';
import { getStoragePath, ensureDbDirectory, dbExists, getDbSize, hasWritePermission } from '../utils/paths.js';
import { logger } from '../../utils/logger.js';
import { MigrationRunner } from './migrations.js';

export interface DatabaseConfig {
  path?: string;                    // Custom path or auto-detect
  maxSizeBytes?: number;           // Default: 100MB
  enableWAL?: boolean;             // Write-Ahead Logging
  busyTimeout?: number;            // Default: 5000ms
}

export class PGLiteManager {
  private static activeConnections = new Set<PGLiteManager>();
  
  private db: PGlite | null = null;
  private config: DatabaseConfig;
  private schemaVersion: number = 1;
  private migrationRunner: MigrationRunner | null = null;
  private initializationPromise: Promise<void> | null = null;
  
  constructor(config: DatabaseConfig = {}) {
    this.config = {
      maxSizeBytes: 100 * 1024 * 1024, // 100MB
      enableWAL: true,
      busyTimeout: 5000,
      ...config
    };
    
    // Add instance to active connections tracking
    PGLiteManager.activeConnections.add(this);
  }
  
  async initialize(): Promise<void> {
    // Prevent concurrent initialization
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize();
    
    try {
      await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  private async _initialize(): Promise<void> {
    try {
      const dbPath = this.config.path || getStoragePath();
      logger.info(`Initializing PGLite database at: ${dbPath}`);

      // Ensure directory exists
      await ensureDbDirectory(dbPath);

      // Check write permissions
      if (!await hasWritePermission(dbPath)) {
        throw new Error(`No write permission for database path: ${dbPath}`);
      }

      // Check database size if it exists
      if (await dbExists(dbPath)) {
        const size = await getDbSize(dbPath);
        if (size > this.config.maxSizeBytes!) {
          logger.warn(`Database size (${size} bytes) exceeds max size (${this.config.maxSizeBytes} bytes)`);
        }
      }

      // Initialize PGLite
      this.db = new PGlite(dbPath);
      
      // Wait for database to be ready
      await this.db.waitReady;

      // PGLite doesn't use SQLite PRAGMAs, it's PostgreSQL
      // WAL is enabled by default in PostgreSQL
      // Busy timeout is handled differently in PostgreSQL

      // Run initial schema
      await this.createInitialSchema();

      // Initialize migration runner and run migrations
      this.migrationRunner = new MigrationRunner(this.db);
      await this.runMigrations();

      logger.info('PGLite database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize PGLite database:', error);
      throw error;
    }
  }

  private async createInitialSchema(): Promise<void> {
    try {
      // Define initial schema inline
      const schema = `
        -- Components table
        CREATE TABLE IF NOT EXISTS components (
          id SERIAL PRIMARY KEY,
          framework VARCHAR(50) NOT NULL,
          name VARCHAR(100) NOT NULL,
          source_code TEXT NOT NULL,
          demo_code TEXT,
          metadata JSONB,
          dependencies TEXT[],
          registry_dependencies TEXT[],
          github_sha VARCHAR(40),
          file_size INTEGER,
          last_modified TIMESTAMP,
          cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          access_count INTEGER DEFAULT 1,
          UNIQUE(framework, name)
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_components_framework_name ON components(framework, name);
        CREATE INDEX IF NOT EXISTS idx_components_cached_at ON components(cached_at);
        CREATE INDEX IF NOT EXISTS idx_components_accessed_at ON components(accessed_at);

        -- Blocks table
        CREATE TABLE IF NOT EXISTS blocks (
          id SERIAL PRIMARY KEY,
          framework VARCHAR(50) NOT NULL,
          name VARCHAR(100) NOT NULL,
          category VARCHAR(50),
          type VARCHAR(20) CHECK (type IN ('simple', 'complex')),
          description TEXT,
          files JSONB NOT NULL,
          structure JSONB,
          dependencies TEXT[],
          components_used TEXT[],
          total_size INTEGER,
          github_sha VARCHAR(40),
          cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          access_count INTEGER DEFAULT 1,
          UNIQUE(framework, name)
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_blocks_framework_name ON blocks(framework, name);
        CREATE INDEX IF NOT EXISTS idx_blocks_category ON blocks(category);

        -- Schema version tracking
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      
      // Execute schema
      await this.db!.exec(schema);
      
      logger.info('Initial schema created successfully');
    } catch (error) {
      logger.error('Failed to create initial schema:', error);
      throw error;
    }
  }
  
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      PGLiteManager.activeConnections.delete(this);
      logger.info('PGLite database closed');
    }
  }
  
  async getConnection(): Promise<PGlite> {
    if (!this.db) {
      await this.initialize();
    }
    return this.db!;
  }
  
  async runMigrations(): Promise<void> {
    if (!this.migrationRunner) {
      throw new Error('Migration runner not initialized');
    }
    
    await this.migrationRunner.runPendingMigrations();
  }
  
  async checkHealth(): Promise<boolean> {
    try {
      if (!this.db) {
        return false;
      }
      
      // Try a simple query
      const result = await this.db.query<{health_check: number}>('SELECT 1 as health_check');
      return result.rows.length > 0 && result.rows[0].health_check === 1;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  async getStats(): Promise<{
    dbPath: string;
    size: number;
    isHealthy: boolean;
    componentCount: number;
    blockCount: number;
  }> {
    const dbPath = this.config.path || getStoragePath();
    const size = await getDbSize(dbPath);
    const isHealthy = await this.checkHealth();
    
    let componentCount = 0;
    let blockCount = 0;
    
    if (isHealthy && this.db) {
      try {
        const componentsResult = await this.db.query<{count: number}>('SELECT COUNT(*) as count FROM components');
        componentCount = componentsResult.rows[0].count;
        
        const blocksResult = await this.db.query<{count: number}>('SELECT COUNT(*) as count FROM blocks');
        blockCount = blocksResult.rows[0].count;
      } catch (error) {
        logger.error('Failed to get database stats:', error);
      }
    }
    
    return {
      dbPath,
      size,
      isHealthy,
      componentCount,
      blockCount
    };
  }
  
  /**
   * Get the number of active PGLite manager instances
   * @returns Number of active connections
   */
  static getActiveConnectionCount(): number {
    return PGLiteManager.activeConnections.size;
  }
  
  /**
   * Close all active PGLite manager instances
   * Useful for cleanup during shutdown
   */
  static async closeAllConnections(): Promise<void> {
    const promises = Array.from(PGLiteManager.activeConnections).map(manager => 
      manager.close().catch(err => logger.error('Error closing connection:', err))
    );
    await Promise.all(promises);
  }
}