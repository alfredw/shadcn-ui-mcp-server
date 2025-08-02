/**
 * PGLite Cache Interface Implementation Example
 * This demonstrates how to integrate PGLite as a persistent storage layer
 */

import { PGlite } from '@electric-sql/pglite';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { logInfo, logError, logWarning } from '../../../src/utils/logger';

// Storage provider interface
export interface StorageProvider {
  initialize(): Promise<void>;
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

// Component data structure
interface ComponentData {
  framework: string;
  name: string;
  sourceCode: string;
  demoCode?: string;
  metadata?: any;
  dependencies?: string[];
  registryDependencies?: string[];
  githubSha?: string;
  fileSize?: number;
}

// Block data structure
interface BlockData {
  framework: string;
  name: string;
  category?: string;
  type: 'simple' | 'complex';
  description?: string;
  files: Record<string, any>;
  structure?: any;
  dependencies?: string[];
  componentsUsed?: string[];
  totalSize?: number;
  githubSha?: string;
}

/**
 * PGLite Storage Provider
 * Implements persistent storage using embedded PostgreSQL
 */
export class PGLiteStorage implements StorageProvider {
  private db: PGlite | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private readonly defaultTTL: number = 7 * 24 * 60 * 60; // 7 days in seconds

  constructor(customPath?: string) {
    this.dbPath = customPath || this.getDefaultPath();
  }

  private getDefaultPath(): string {
    // Determine if running via npx
    const isNpx = process.argv[1]?.includes('_npx') || false;
    
    if (isNpx || !process.env.SHADCN_MCP_LOCAL_PATH) {
      // Default to user's home directory
      return path.join(os.homedir(), '.shadcn-mcp', 'cache.db');
    }
    
    return process.env.SHADCN_MCP_LOCAL_PATH;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      await fs.mkdir(dir, { recursive: true });

      logInfo(`Initializing PGLite database at: ${this.dbPath}`);

      // Initialize PGLite
      this.db = new PGlite(this.dbPath);

      // Load schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = await fs.readFile(schemaPath, 'utf-8');
      await this.db.exec(schema);

      this.initialized = true;
      logInfo('PGLite database initialized successfully');

      // Log cache health
      await this.logCacheHealth();
    } catch (error) {
      logError('Failed to initialize PGLite database', error);
      throw error;
    }
  }

  async get(key: string): Promise<any | null> {
    if (!this.initialized) await this.initialize();

    try {
      const [framework, type, name] = this.parseKey(key);
      const startTime = Date.now();

      if (type === 'component') {
        const result = await this.db!.query<ComponentData>(`
          SELECT * FROM components 
          WHERE framework = $1 AND name = $2
          AND (
            ttl_override IS NULL AND cached_at > CURRENT_TIMESTAMP - INTERVAL '${this.defaultTTL} seconds'
            OR ttl_override IS NOT NULL AND cached_at > CURRENT_TIMESTAMP - (ttl_override || ' seconds')::INTERVAL
          )
        `, [framework, name]);

        const responseTime = Date.now() - startTime;
        const cacheHit = result.rows.length > 0;

        // Update statistics
        await this.updateStats(framework, 'component', name, cacheHit, responseTime);

        if (cacheHit) {
          return {
            sourceCode: result.rows[0].sourceCode,
            demoCode: result.rows[0].demoCode,
            metadata: result.rows[0].metadata,
            dependencies: result.rows[0].dependencies,
            registryDependencies: result.rows[0].registryDependencies,
          };
        }
      } else if (type === 'block') {
        const result = await this.db!.query<BlockData>(`
          SELECT * FROM blocks 
          WHERE framework = $1 AND name = $2
          AND (
            ttl_override IS NULL AND cached_at > CURRENT_TIMESTAMP - INTERVAL '${this.defaultTTL} seconds'
            OR ttl_override IS NOT NULL AND cached_at > CURRENT_TIMESTAMP - (ttl_override || ' seconds')::INTERVAL
          )
        `, [framework, name]);

        const responseTime = Date.now() - startTime;
        const cacheHit = result.rows.length > 0;

        // Update statistics
        await this.updateStats(framework, 'block', name, cacheHit, responseTime);

        if (cacheHit) {
          return result.rows[0];
        }
      }

      return null;
    } catch (error) {
      logError(`Failed to get ${key} from PGLite cache`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.initialized) await this.initialize();

    try {
      const [framework, type, name] = this.parseKey(key);

      if (type === 'component') {
        const data = value as ComponentData;
        await this.db!.query(`
          INSERT INTO components (
            framework, name, source_code, demo_code, metadata,
            dependencies, registry_dependencies, github_sha, file_size,
            ttl_override
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (framework, name) DO UPDATE SET
            source_code = EXCLUDED.source_code,
            demo_code = EXCLUDED.demo_code,
            metadata = EXCLUDED.metadata,
            dependencies = EXCLUDED.dependencies,
            registry_dependencies = EXCLUDED.registry_dependencies,
            github_sha = EXCLUDED.github_sha,
            file_size = EXCLUDED.file_size,
            cached_at = CURRENT_TIMESTAMP,
            ttl_override = EXCLUDED.ttl_override
        `, [
          framework,
          name,
          data.sourceCode,
          data.demoCode,
          JSON.stringify(data.metadata || {}),
          data.dependencies || [],
          data.registryDependencies || [],
          data.githubSha,
          data.sourceCode?.length || 0,
          ttl
        ]);
      } else if (type === 'block') {
        const data = value as BlockData;
        await this.db!.query(`
          INSERT INTO blocks (
            framework, name, category, type, description,
            files, structure, dependencies, components_used,
            total_size, file_count, github_sha, ttl_override
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (framework, name) DO UPDATE SET
            category = EXCLUDED.category,
            type = EXCLUDED.type,
            description = EXCLUDED.description,
            files = EXCLUDED.files,
            structure = EXCLUDED.structure,
            dependencies = EXCLUDED.dependencies,
            components_used = EXCLUDED.components_used,
            total_size = EXCLUDED.total_size,
            file_count = EXCLUDED.file_count,
            github_sha = EXCLUDED.github_sha,
            cached_at = CURRENT_TIMESTAMP,
            ttl_override = EXCLUDED.ttl_override
        `, [
          framework,
          name,
          data.category,
          data.type,
          data.description,
          JSON.stringify(data.files),
          JSON.stringify(data.structure || {}),
          data.dependencies || [],
          data.componentsUsed || [],
          data.totalSize || 0,
          Object.keys(data.files).length,
          data.githubSha,
          ttl
        ]);
      }

      // Update registry if needed
      await this.updateRegistry(framework, name, type);
    } catch (error) {
      logError(`Failed to set ${key} in PGLite cache`, error);
      throw error;
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    try {
      const [framework, type, name] = this.parseKey(key);
      const table = type === 'component' ? 'components' : 'blocks';

      const result = await this.db!.query(`
        SELECT 1 FROM ${table}
        WHERE framework = $1 AND name = $2
        AND (
          ttl_override IS NULL AND cached_at > CURRENT_TIMESTAMP - INTERVAL '${this.defaultTTL} seconds'
          OR ttl_override IS NOT NULL AND cached_at > CURRENT_TIMESTAMP - (ttl_override || ' seconds')::INTERVAL
        )
        LIMIT 1
      `, [framework, name]);

      return result.rows.length > 0;
    } catch (error) {
      logError(`Failed to check ${key} in PGLite cache`, error);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    try {
      const [framework, type, name] = this.parseKey(key);
      const table = type === 'component' ? 'components' : 'blocks';

      const result = await this.db!.query(`
        DELETE FROM ${table}
        WHERE framework = $1 AND name = $2
        RETURNING 1
      `, [framework, name]);

      return result.rows.length > 0;
    } catch (error) {
      logError(`Failed to delete ${key} from PGLite cache`, error);
      return false;
    }
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize();

    try {
      await this.db!.query('TRUNCATE TABLE components, blocks, component_registry, cache_stats, request_log');
      logInfo('PGLite cache cleared successfully');
    } catch (error) {
      logError('Failed to clear PGLite cache', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  // Helper methods

  private parseKey(key: string): [string, string, string] {
    // Key format: "framework:type:name" e.g., "react:component:button"
    const parts = key.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid cache key format: ${key}`);
    }
    return [parts[0], parts[1], parts[2]];
  }

  private async updateStats(
    framework: string,
    resourceType: string,
    resourceName: string,
    cacheHit: boolean,
    responseTimeMs: number
  ): Promise<void> {
    try {
      await this.db!.query(
        'SELECT update_access_stats($1, $2, $3, $4, $5)',
        [framework, resourceType, resourceName, cacheHit, responseTimeMs]
      );
    } catch (error) {
      logWarning('Failed to update cache statistics', error);
    }
  }

  private async updateRegistry(framework: string, name: string, type: string): Promise<void> {
    try {
      await this.db!.query(`
        INSERT INTO component_registry (framework, name, category)
        VALUES ($1, $2, $3)
        ON CONFLICT (framework, name) DO UPDATE SET
          last_seen = CURRENT_TIMESTAMP
      `, [framework, name, type]);
    } catch (error) {
      logWarning('Failed to update component registry', error);
    }
  }

  private async logCacheHealth(): Promise<void> {
    try {
      const health = await this.db!.query('SELECT * FROM cache_health');
      logInfo('Cache health:', health.rows);
    } catch (error) {
      logWarning('Failed to get cache health', error);
    }
  }

  // Public utility methods

  async getStats(): Promise<any> {
    if (!this.initialized) await this.initialize();

    const stats = await this.db!.query(`
      SELECT 
        SUM(hits) as total_hits,
        SUM(misses) as total_misses,
        SUM(github_fetches) as total_fetches,
        ROUND(AVG(avg_response_time_ms)::numeric, 2) as avg_response_time,
        ROUND((SUM(hits)::float / NULLIF(SUM(hits) + SUM(misses), 0) * 100)::numeric, 2) as hit_rate
      FROM cache_stats
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    `);

    const health = await this.db!.query('SELECT * FROM cache_health');

    return {
      performance: stats.rows[0],
      storage: health.rows,
    };
  }

  async cleanExpired(): Promise<number> {
    if (!this.initialized) await this.initialize();

    const result = await this.db!.query('SELECT * FROM clean_expired_cache()');
    const totalDeleted = result.rows.reduce((sum, row) => sum + row.deleted_count, 0);
    
    logInfo(`Cleaned ${totalDeleted} expired cache entries`);
    return totalDeleted;
  }

  async getPopularComponents(limit: number = 20): Promise<any[]> {
    if (!this.initialized) await this.initialize();

    const result = await this.db!.query(`
      SELECT * FROM popular_components LIMIT $1
    `, [limit]);

    return result.rows;
  }
}

/**
 * Hybrid Storage Implementation
 * Combines memory cache (L1) with PGLite (L2) and GitHub (source)
 */
export class HybridStorage {
  private memory: Map<string, { value: any; expires: number }>;
  private pglite: PGLiteStorage;
  private memoryTTL: number = 3600000; // 1 hour in memory

  constructor(pglitePath?: string) {
    this.memory = new Map();
    this.pglite = new PGLiteStorage(pglitePath);
  }

  async initialize(): Promise<void> {
    await this.pglite.initialize();
  }

  async get(key: string, fetchFn?: () => Promise<any>): Promise<any | null> {
    // Check memory cache first (L1)
    const memoryItem = this.memory.get(key);
    if (memoryItem && memoryItem.expires > Date.now()) {
      return memoryItem.value;
    }

    // Check PGLite cache (L2)
    const pgliteValue = await this.pglite.get(key);
    if (pgliteValue !== null) {
      // Promote to memory cache
      this.memory.set(key, {
        value: pgliteValue,
        expires: Date.now() + this.memoryTTL
      });
      return pgliteValue;
    }

    // Fetch from source if function provided
    if (fetchFn) {
      const value = await fetchFn();
      if (value !== null) {
        // Store in both caches
        await this.pglite.set(key, value);
        this.memory.set(key, {
          value,
          expires: Date.now() + this.memoryTTL
        });
      }
      return value;
    }

    return null;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    // Set in both caches
    await this.pglite.set(key, value, ttl);
    this.memory.set(key, {
      value,
      expires: Date.now() + this.memoryTTL
    });
  }

  async clearMemory(): void {
    this.memory.clear();
  }

  async close(): Promise<void> {
    await this.pglite.close();
    this.memory.clear();
  }

  // Periodic cleanup
  startCleanupInterval(intervalMs: number = 3600000): NodeJS.Timer {
    return setInterval(async () => {
      // Clean expired memory entries
      const now = Date.now();
      for (const [key, item] of this.memory.entries()) {
        if (item.expires < now) {
          this.memory.delete(key);
        }
      }

      // Clean expired PGLite entries
      await this.pglite.cleanExpired();
    }, intervalMs);
  }
}