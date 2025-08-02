import { StorageMetadata, StorageProviderConfig } from '../interfaces/storage-provider.js';
import { BaseStorageProvider } from './base-storage-provider.js';
import { PGLiteManager } from '../database/manager.js';
import { getDatabaseManager, executeQuery, executeTransaction } from '../database/connection.js';
import { PGlite } from '@electric-sql/pglite';

export interface ParsedKey {
  type: 'component' | 'block' | 'metadata' | 'other';
  framework?: string;
  name?: string;
  subkey?: string;
}

export interface Component {
  framework: string;
  name: string;
  sourceCode: string;
  demoCode?: string;
  metadata?: any;
  dependencies?: string[];
  registryDependencies?: string[];
  githubSha?: string;
  fileSize?: number;
  lastModified?: Date;
}

export interface ComponentMetadata {
  framework: string;
  name: string;
  fileSize?: number;
  lastModified?: Date;
  dependencies?: string[];
  registryDependencies?: string[];
}

export interface Block {
  framework: string;
  name: string;
  category?: string;
  type?: 'simple' | 'complex';
  description?: string;
  files: any;
  structure?: any;
  dependencies?: string[];
  componentsUsed?: string[];
  totalSize?: number;
  githubSha?: string;
}

export interface BlockMetadata {
  framework: string;
  name: string;
  category?: string;
  type?: 'simple' | 'complex';
  description?: string;
  totalSize?: number;
}

/**
 * PGLite-based storage provider that implements persistent storage
 * for components and blocks using the established database schema
 */
export class PGLiteStorageProvider extends BaseStorageProvider {
  private dbManager: PGLiteManager;
  private db: PGlite | null = null;
  
  constructor(dbManager?: PGLiteManager, config?: StorageProviderConfig) {
    super(config);
    this.dbManager = dbManager || getDatabaseManager();
  }
  
  async initialize(): Promise<void> {
    this.db = await this.dbManager.getConnection();
    this.debug('PGLite storage provider initialized');
  }
  
  /**
   * Properly dispose of database connections and resources
   * Note: We don't close the database connection here because it's managed globally
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    this.debug('Disposing PGLite storage provider');
    
    // Don't close the database connection - it's managed by the global manager
    // Just clear our local reference
    this.db = null;
    
    await super.dispose(); // Call parent disposal logic
  }
  
  /**
   * Parse a storage key into its components
   * @param key Storage key to parse (e.g., "component:react:button")
   * @returns Parsed key information
   */
  parseKey(key: string): ParsedKey {
    const parts = key.split(':');
    
    if (parts.length < 1) {
      return { type: 'other' };
    }
    
    const type = parts[0] as ParsedKey['type'];
    
    switch (type) {
      case 'component':
      case 'block':
        return {
          type,
          framework: parts[1],
          name: parts[2],
          subkey: parts.slice(3).join(':')
        };
      case 'metadata':
        return {
          type,
          name: parts.slice(1).join(':')
        };
      default:
        return { type: 'other' };
    }
  }
  
  /**
   * Build a storage key from components
   * @param type Type of storage (component, block, metadata)
   * @param framework Framework name (for components/blocks)
   * @param name Item name
   * @returns Built storage key
   */
  buildKey(type: string, framework: string, name: string): string {
    return `${type}:${framework}:${name}`;
  }
  
  /**
   * Check if a key is for a component
   * @param key Storage key
   * @returns True if key is for a component
   */
  isComponentKey(key: string): boolean {
    return this.parseKey(key).type === 'component';
  }
  
  /**
   * Check if a key is for a block
   * @param key Storage key
   * @returns True if key is for a block
   */
  isBlockKey(key: string): boolean {
    return this.parseKey(key).type === 'block';
  }
  
  /**
   * Get the database connection
   * @returns PGlite database instance
   */
  private async getDb(): Promise<PGlite> {
    if (!this.db) {
      await this.initialize();
    }
    return this.db!;
  }
  
  /**
   * Check if an item has expired based on TTL
   * @param cachedAt When the item was cached
   * @param ttl TTL in seconds (0 = no expiration)
   * @returns True if expired
   */
  private isExpiredByTTL(cachedAt: Date, ttl: number): boolean {
    if (ttl <= 0) {
      return false;
    }
    const now = new Date();
    const expireTime = new Date(cachedAt.getTime() + (ttl * 1000));
    return now > expireTime;
  }
  
  // Abstract method implementations required by StorageProvider interface
  
  async get(key: string): Promise<any> {
    return this.wrapOperation(`get(${key})`, async () => {
      this.validateKey(key);
      this.ensureNotDisposed();
      
      const parsed = this.parseKey(key);
      
      if (parsed.type === 'component' && parsed.framework && parsed.name) {
        return this.getComponent(parsed.framework, parsed.name);
      } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
        return this.getBlock(parsed.framework, parsed.name);
      } else {
        // Handle generic storage (metadata, etc.)
        return this.getGeneric(key);
      }
    });
  }
  
  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.wrapOperation(`set(${key})`, async () => {
      this.validateKey(key);
      this.ensureNotDisposed();
      
      const parsed = this.parseKey(key);
      
      if (parsed.type === 'component' && parsed.framework && parsed.name) {
        await this.setComponent(value as Component);
      } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
        await this.setBlock(value as Block);
      } else {
        // Handle generic storage
        await this.setGeneric(key, value, ttl);
      }
    });
  }
  
  async has(key: string): Promise<boolean> {
    return this.wrapOperation(`has(${key})`, async () => {
      this.validateKey(key);
      this.ensureNotDisposed();
      
      const parsed = this.parseKey(key);
      
      if (parsed.type === 'component' && parsed.framework && parsed.name) {
        const component = await this.getComponent(parsed.framework, parsed.name);
        return component !== undefined;
      } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
        const block = await this.getBlock(parsed.framework, parsed.name);
        return block !== undefined;
      } else {
        const value = await this.getGeneric(key);
        return value !== undefined;
      }
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.wrapOperation(`delete(${key})`, async () => {
      this.validateKey(key);
      this.ensureNotDisposed();
      
      const parsed = this.parseKey(key);
      
      if (parsed.type === 'component' && parsed.framework && parsed.name) {
        return this.deleteComponent(parsed.framework, parsed.name);
      } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
        return this.deleteBlock(parsed.framework, parsed.name);
      } else {
        return this.deleteGeneric(key);
      }
    });
  }
  
  async clear(): Promise<void> {
    return this.wrapOperation('clear()', async () => {
      this.ensureNotDisposed();
      
      await executeTransaction(async (tx) => {
        await tx.query('DELETE FROM components');
        await tx.query('DELETE FROM blocks');
        // Add generic storage table cleanup here when implemented
      });
      
      this.debug('Cleared all storage');
    });
  }
  
  async mget(keys: string[]): Promise<Map<string, any>> {
    return this.wrapOperation(`mget([${keys.length} keys])`, async () => {
      this.ensureNotDisposed();
      
      const result = new Map<string, any>();
      
      // Separate keys by type for batch processing
      const componentKeys: string[] = [];
      const blockKeys: string[] = [];
      const genericKeys: string[] = [];
      
      for (const key of keys) {
        const parsed = this.parseKey(key);
        if (parsed.type === 'component') {
          componentKeys.push(key);
        } else if (parsed.type === 'block') {
          blockKeys.push(key);
        } else {
          genericKeys.push(key);
        }
      }
      
      // Batch fetch components
      if (componentKeys.length > 0) {
        const components = await this.batchFetchComponents(componentKeys);
        components.forEach((comp, key) => result.set(key, comp));
      }
      
      // Batch fetch blocks
      if (blockKeys.length > 0) {
        const blocks = await this.batchFetchBlocks(blockKeys);
        blocks.forEach((block, key) => result.set(key, block));
      }
      
      // Handle generic keys one by one for now
      for (const key of genericKeys) {
        const value = await this.getGeneric(key);
        if (value !== undefined) {
          result.set(key, value);
        }
      }
      
      return result;
    });
  }
  
  async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
    return this.wrapOperation(`mset([${entries.size} entries])`, async () => {
      this.ensureNotDisposed();
      
      // Process entries in a transaction for atomicity - use transaction-aware methods
      await executeTransaction(async (tx) => {
        for (const [key, value] of entries) {
          const parsed = this.parseKey(key);
          
          if (parsed.type === 'component' && parsed.framework && parsed.name) {
            await this.setComponentInTransaction(tx, value as Component);
          } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
            await this.setBlockInTransaction(tx, value as Block);
          } else {
            // Handle generic storage - for now skip since it's not implemented
            // TODO: Implement generic storage in transaction
            this.debug(`Skipping generic key in mset transaction: ${key}`);
          }
        }
      });
    });
  }
  
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    return this.wrapOperation(`getMetadata(${key})`, async () => {
      this.validateKey(key);
      this.ensureNotDisposed();
      
      const parsed = this.parseKey(key);
      
      if (parsed.type === 'component' && parsed.framework && parsed.name) {
        return this.getComponentMetadata(parsed.framework, parsed.name);
      } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
        return this.getBlockMetadata(parsed.framework, parsed.name);
      } else {
        return this.getGenericMetadata(key);
      }
    });
  }
  
  async keys(pattern?: string): Promise<string[]> {
    return this.wrapOperation(`keys(${pattern ?? '*'})`, async () => {
      this.ensureNotDisposed();
      
      const allKeys: string[] = [];
      
      // Get component keys
      const componentKeys = await this.getComponentKeys();
      allKeys.push(...componentKeys);
      
      // Get block keys
      const blockKeys = await this.getBlockKeys();
      allKeys.push(...blockKeys);
      
      // Get generic keys (when implemented)
      // const genericKeys = await this.getGenericKeys();
      // allKeys.push(...genericKeys);
      
      return this.matchPattern(allKeys, pattern);
    });
  }
  
  async size(): Promise<number> {
    return this.wrapOperation('size()', async () => {
      this.ensureNotDisposed();
      
      const stats = await this.dbManager.getStats();
      return stats.componentCount + stats.blockCount;
    });
  }
  
  // Component-specific methods
  
  async getComponent(framework: string, name: string): Promise<Component | undefined> {
    // First check if the component exists and is not expired
    const checkQuery = `
      SELECT *, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) as age_seconds
      FROM components 
      WHERE framework = $1 AND name = $2
    `;
    
    const checkRows = await executeQuery<any>(checkQuery, [framework, name]);
    
    if (checkRows.length === 0) {
      return undefined;
    }
    
    const row = checkRows[0];
    
    // Check if expired (using database-calculated age to avoid timezone issues)
    const ageSeconds = parseFloat(row.age_seconds || 0);
    const isExpired = this.config.defaultTTL > 0 && ageSeconds > this.config.defaultTTL;
    
    if (isExpired) {
      // Delete expired component
      await this.deleteComponent(framework, name);
      return undefined;
    }
    
    // Update access tracking
    const updateQuery = `
      UPDATE components 
      SET accessed_at = CURRENT_TIMESTAMP, 
          access_count = access_count + 1
      WHERE framework = $1 AND name = $2
    `;
    
    await executeQuery(updateQuery, [framework, name]);
    
    return {
      framework: row.framework,
      name: row.name,
      sourceCode: row.source_code,
      demoCode: row.demo_code,
      metadata: row.metadata,
      dependencies: row.dependencies,
      registryDependencies: row.registry_dependencies,
      githubSha: row.github_sha,
      fileSize: row.file_size,
      lastModified: row.last_modified
    };
  }
  
  async setComponent(component: Component): Promise<void> {
    const query = `
      INSERT INTO components (
        framework, name, source_code, demo_code, metadata,
        dependencies, registry_dependencies, github_sha,
        file_size, last_modified, cached_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (framework, name) 
      DO UPDATE SET
        source_code = EXCLUDED.source_code,
        demo_code = EXCLUDED.demo_code,
        metadata = EXCLUDED.metadata,
        dependencies = EXCLUDED.dependencies,
        registry_dependencies = EXCLUDED.registry_dependencies,
        github_sha = EXCLUDED.github_sha,
        file_size = EXCLUDED.file_size,
        last_modified = EXCLUDED.last_modified,
        cached_at = CURRENT_TIMESTAMP,
        access_count = components.access_count + 1
    `;
    
    await executeQuery(query, [
      component.framework,
      component.name,
      component.sourceCode,
      component.demoCode,
      component.metadata,
      component.dependencies,
      component.registryDependencies,
      component.githubSha,
      component.fileSize,
      component.lastModified
    ]);
    
    this.debug(`Stored component: ${component.framework}:${component.name}`);
  }

  /**
   * Transaction-aware version of setComponent for use within transactions
   * @param tx Transaction object
   * @param component Component to store
   */
  private async setComponentInTransaction(tx: any, component: Component): Promise<void> {
    const query = `
      INSERT INTO components (
        framework, name, source_code, demo_code, metadata,
        dependencies, registry_dependencies, github_sha,
        file_size, last_modified, cached_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (framework, name) 
      DO UPDATE SET
        source_code = EXCLUDED.source_code,
        demo_code = EXCLUDED.demo_code,
        metadata = EXCLUDED.metadata,
        dependencies = EXCLUDED.dependencies,
        registry_dependencies = EXCLUDED.registry_dependencies,
        github_sha = EXCLUDED.github_sha,
        file_size = EXCLUDED.file_size,
        last_modified = EXCLUDED.last_modified,
        cached_at = CURRENT_TIMESTAMP,
        access_count = components.access_count + 1
    `;
    
    await tx.query(query, [
      component.framework,
      component.name,
      component.sourceCode,
      component.demoCode,
      component.metadata,
      component.dependencies,
      component.registryDependencies,
      component.githubSha,
      component.fileSize,
      component.lastModified
    ]);
    
    this.debug(`Stored component in transaction: ${component.framework}:${component.name}`);
  }
  
  async listComponents(framework: string): Promise<ComponentMetadata[]> {
    const query = `
      SELECT framework, name, file_size, last_modified, dependencies, registry_dependencies
      FROM components 
      WHERE framework = $1
      ORDER BY name ASC
    `;
    
    const rows = await executeQuery<any>(query, [framework]);
    
    return rows.map(row => ({
      framework: row.framework,
      name: row.name,
      fileSize: row.file_size,
      lastModified: row.last_modified,
      dependencies: row.dependencies,
      registryDependencies: row.registry_dependencies
    }));
  }
  
  // Block-specific methods
  
  async getBlock(framework: string, name: string): Promise<Block | undefined> {
    // First check if the block exists and is not expired
    const checkQuery = `
      SELECT *, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) as age_seconds
      FROM blocks 
      WHERE framework = $1 AND name = $2
    `;
    
    const checkRows = await executeQuery<any>(checkQuery, [framework, name]);
    
    if (checkRows.length === 0) {
      return undefined;
    }
    
    const row = checkRows[0];
    
    // Check if expired (using default TTL)
    if (this.isExpiredByTTL(row.cached_at, this.config.defaultTTL)) {
      // Delete expired block
      await this.deleteBlock(framework, name);
      return undefined;
    }
    
    // Update access tracking
    const updateQuery = `
      UPDATE blocks 
      SET accessed_at = CURRENT_TIMESTAMP, 
          access_count = access_count + 1
      WHERE framework = $1 AND name = $2
    `;
    
    await executeQuery(updateQuery, [framework, name]);
    
    return {
      framework: row.framework,
      name: row.name,
      category: row.category,
      type: row.type,
      description: row.description,
      files: row.files,
      structure: row.structure,
      dependencies: row.dependencies,
      componentsUsed: row.components_used,
      totalSize: row.total_size,
      githubSha: row.github_sha
    };
  }
  
  async setBlock(block: Block): Promise<void> {
    const query = `
      INSERT INTO blocks (
        framework, name, category, type, description, files,
        structure, dependencies, components_used, total_size,
        github_sha, cached_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (framework, name) 
      DO UPDATE SET
        category = EXCLUDED.category,
        type = EXCLUDED.type,
        description = EXCLUDED.description,
        files = EXCLUDED.files,
        structure = EXCLUDED.structure,
        dependencies = EXCLUDED.dependencies,
        components_used = EXCLUDED.components_used,
        total_size = EXCLUDED.total_size,
        github_sha = EXCLUDED.github_sha,
        cached_at = CURRENT_TIMESTAMP,
        access_count = blocks.access_count + 1
    `;
    
    await executeQuery(query, [
      block.framework,
      block.name,
      block.category,
      block.type,
      block.description,
      block.files,
      block.structure,
      block.dependencies,
      block.componentsUsed,
      block.totalSize,
      block.githubSha
    ]);
    
    this.debug(`Stored block: ${block.framework}:${block.name}`);
  }

  /**
   * Transaction-aware version of setBlock for use within transactions
   * @param tx Transaction object
   * @param block Block to store
   */
  private async setBlockInTransaction(tx: any, block: Block): Promise<void> {
    const query = `
      INSERT INTO blocks (
        framework, name, category, type, description, files,
        structure, dependencies, components_used, total_size,
        github_sha, cached_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
      ON CONFLICT (framework, name) 
      DO UPDATE SET
        category = EXCLUDED.category,
        type = EXCLUDED.type,
        description = EXCLUDED.description,
        files = EXCLUDED.files,
        structure = EXCLUDED.structure,
        dependencies = EXCLUDED.dependencies,
        components_used = EXCLUDED.components_used,
        total_size = EXCLUDED.total_size,
        github_sha = EXCLUDED.github_sha,
        cached_at = CURRENT_TIMESTAMP,
        access_count = blocks.access_count + 1
    `;
    
    await tx.query(query, [
      block.framework,
      block.name,
      block.category,
      block.type,
      block.description,
      block.files,
      block.structure,
      block.dependencies,
      block.componentsUsed,
      block.totalSize,
      block.githubSha
    ]);
    
    this.debug(`Stored block in transaction: ${block.framework}:${block.name}`);
  }
  
  async listBlocks(framework: string, category?: string): Promise<BlockMetadata[]> {
    let query = `
      SELECT framework, name, category, type, description, total_size
      FROM blocks 
      WHERE framework = $1
    `;
    const params: any[] = [framework];
    
    if (category) {
      query += ' AND category = $2';
      params.push(category);
    }
    
    query += ' ORDER BY name ASC';
    
    const rows = await executeQuery<any>(query, params);
    
    return rows.map(row => ({
      framework: row.framework,
      name: row.name,
      category: row.category,
      type: row.type,
      description: row.description,
      totalSize: row.total_size
    }));
  }
  
  // Private helper methods
  
  private async deleteComponent(framework: string, name: string): Promise<boolean> {
    const query = 'DELETE FROM components WHERE framework = $1 AND name = $2';
    const db = await this.getDb();
    const result = await db.query(query, [framework, name]);
    return (result.affectedRows || 0) > 0;
  }
  
  private async deleteBlock(framework: string, name: string): Promise<boolean> {
    const query = 'DELETE FROM blocks WHERE framework = $1 AND name = $2';
    const db = await this.getDb();
    const result = await db.query(query, [framework, name]);
    return (result.affectedRows || 0) > 0;
  }
  
  private async getComponentKeys(): Promise<string[]> {
    const query = 'SELECT framework, name FROM components';
    const rows = await executeQuery<{framework: string, name: string}>(query);
    return rows.map(row => this.buildKey('component', row.framework, row.name));
  }
  
  private async getBlockKeys(): Promise<string[]> {
    const query = 'SELECT framework, name FROM blocks';
    const rows = await executeQuery<{framework: string, name: string}>(query);
    return rows.map(row => this.buildKey('block', row.framework, row.name));
  }
  
  private async getComponentMetadata(framework: string, name: string): Promise<StorageMetadata | null> {
    const query = `
      SELECT file_size, cached_at, accessed_at, access_count
      FROM components 
      WHERE framework = $1 AND name = $2
    `;
    
    const rows = await executeQuery<any>(query, [framework, name]);
    
    if (rows.length === 0) {
      return null;
    }
    
    const row = rows[0];
    const key = this.buildKey('component', framework, name);
    
    return {
      key,
      size: row.file_size || this.calculateSize({}),
      ttl: this.config.defaultTTL,
      createdAt: row.cached_at,
      updatedAt: row.cached_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count
    };
  }
  
  private async getBlockMetadata(framework: string, name: string): Promise<StorageMetadata | null> {
    const query = `
      SELECT total_size, cached_at, accessed_at, access_count
      FROM blocks 
      WHERE framework = $1 AND name = $2
    `;
    
    const rows = await executeQuery<any>(query, [framework, name]);
    
    if (rows.length === 0) {
      return null;
    }
    
    const row = rows[0];
    const key = this.buildKey('block', framework, name);
    
    return {
      key,
      size: row.total_size || this.calculateSize({}),
      ttl: this.config.defaultTTL,
      createdAt: row.cached_at,
      updatedAt: row.cached_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count
    };
  }
  
  private async batchFetchComponents(keys: string[]): Promise<Map<string, Component>> {
    const result = new Map<string, Component>();
    
    const frameworkNamePairs = keys.map(key => {
      const parsed = this.parseKey(key);
      return { framework: parsed.framework!, name: parsed.name!, key };
    });
    
    if (frameworkNamePairs.length === 0) {
      return result;
    }
    
    // Build a query to fetch multiple components
    const placeholders = frameworkNamePairs.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(', ');
    const query = `
      UPDATE components 
      SET accessed_at = CURRENT_TIMESTAMP, 
          access_count = access_count + 1
      WHERE (framework, name) IN (${placeholders})
      RETURNING *
    `;
    
    const params = frameworkNamePairs.flatMap(pair => [pair.framework, pair.name]);
    const rows = await executeQuery<any>(query, params);
    
    for (const row of rows) {
      const key = this.buildKey('component', row.framework, row.name);
      result.set(key, {
        framework: row.framework,
        name: row.name,
        sourceCode: row.source_code,
        demoCode: row.demo_code,
        metadata: row.metadata,
        dependencies: row.dependencies,
        registryDependencies: row.registry_dependencies,
        githubSha: row.github_sha,
        fileSize: row.file_size,
        lastModified: row.last_modified
      });
    }
    
    return result;
  }
  
  private async batchFetchBlocks(keys: string[]): Promise<Map<string, Block>> {
    const result = new Map<string, Block>();
    
    const frameworkNamePairs = keys.map(key => {
      const parsed = this.parseKey(key);
      return { framework: parsed.framework!, name: parsed.name!, key };
    });
    
    if (frameworkNamePairs.length === 0) {
      return result;
    }
    
    // Build a query to fetch multiple blocks
    const placeholders = frameworkNamePairs.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(', ');
    const query = `
      UPDATE blocks 
      SET accessed_at = CURRENT_TIMESTAMP, 
          access_count = access_count + 1
      WHERE (framework, name) IN (${placeholders})
      RETURNING *
    `;
    
    const params = frameworkNamePairs.flatMap(pair => [pair.framework, pair.name]);
    const rows = await executeQuery<any>(query, params);
    
    for (const row of rows) {
      const key = this.buildKey('block', row.framework, row.name);
      result.set(key, {
        framework: row.framework,
        name: row.name,
        category: row.category,
        type: row.type,
        description: row.description,
        files: row.files,
        structure: row.structure,
        dependencies: row.dependencies,
        componentsUsed: row.components_used,
        totalSize: row.total_size,
        githubSha: row.github_sha
      });
    }
    
    return result;
  }
  
  // Generic storage methods for non-component/block data
  // For now, these are placeholder implementations
  // In a full implementation, you might add a generic_storage table
  
  private async getGeneric(key: string): Promise<any> {
    // TODO: Implement generic storage table
    return undefined;
  }
  
  private async setGeneric(key: string, value: any, ttl?: number): Promise<void> {
    // TODO: Implement generic storage table
    this.debug(`Generic storage not yet implemented for key: ${key}`);
  }
  
  private async deleteGeneric(key: string): Promise<boolean> {
    // TODO: Implement generic storage table
    return false;
  }
  
  private async getGenericMetadata(key: string): Promise<StorageMetadata | null> {
    // TODO: Implement generic storage table
    return null;
  }
  
  // TTL and cache management methods
  
  /**
   * Clean up all expired entries from the cache
   * @returns Number of entries cleaned up
   */
  async cleanupExpired(): Promise<number> {
    return this.wrapOperation('cleanupExpired()', async () => {
      this.ensureNotDisposed();
      
      let cleanedCount = 0;
      
      await executeTransaction(async (tx) => {
        // Clean up expired components
        const expiredComponentsQuery = `
          DELETE FROM components 
          WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) > $1
        `;
        const componentResult = await tx.query(expiredComponentsQuery, [this.config.defaultTTL]);
        cleanedCount += componentResult.rowCount || 0;
        
        // Clean up expired blocks  
        const expiredBlocksQuery = `
          DELETE FROM blocks 
          WHERE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) > $1
        `;
        const blockResult = await tx.query(expiredBlocksQuery, [this.config.defaultTTL]);
        cleanedCount += blockResult.rowCount || 0;
      });
      
      if (cleanedCount > 0) {
        this.debug(`Cleaned up ${cleanedCount} expired entries`);
      }
      
      return cleanedCount;
    });
  }
  
  /**
   * Get TTL remaining for a component or block
   * @param framework Framework name
   * @param name Item name
   * @param type Type (component or block)
   * @returns TTL remaining in seconds, or null if not found/expired
   */
  async getTTLRemaining(framework: string, name: string, type: 'component' | 'block'): Promise<number | null> {
    const table = type === 'component' ? 'components' : 'blocks';
    const query = `
      SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) as age_seconds
      FROM ${table}
      WHERE framework = $1 AND name = $2
    `;
    
    const rows = await executeQuery<{age_seconds: number}>(query, [framework, name]);
    
    if (rows.length === 0) {
      return null;
    }
    
    const ageSeconds = rows[0].age_seconds;
    const remaining = this.config.defaultTTL - ageSeconds;
    
    return remaining > 0 ? Math.round(remaining) : 0;
  }
  
  /**
   * Refresh the TTL for a component or block (update cached_at to current time)
   * @param framework Framework name
   * @param name Item name
   * @param type Type (component or block)
   * @returns True if refreshed, false if not found
   */
  async refreshTTL(framework: string, name: string, type: 'component' | 'block'): Promise<boolean> {
    const table = type === 'component' ? 'components' : 'blocks';
    const query = `
      UPDATE ${table}
      SET cached_at = CURRENT_TIMESTAMP
      WHERE framework = $1 AND name = $2
    `;
    
    const db = await this.getDb();
    const result = await db.query(query, [framework, name]);
    const refreshed = (result.affectedRows || 0) > 0;
    
    if (refreshed) {
      this.debug(`Refreshed TTL for ${type}: ${framework}:${name}`);
    }
    
    return refreshed;
  }
  
  /**
   * Get statistics about cache usage and TTL status
   * @returns Cache statistics
   */
  async getCacheStats(): Promise<{
    totalComponents: number;
    totalBlocks: number;
    expiredComponents: number;
    expiredBlocks: number;
    totalSize: number;
    avgComponentAge: number;
    avgBlockAge: number;
  }> {
    return this.wrapOperation('getCacheStats()', async () => {
      this.ensureNotDisposed();
      
      const stats = {
        totalComponents: 0,
        totalBlocks: 0,
        expiredComponents: 0,
        expiredBlocks: 0,
        totalSize: 0,
        avgComponentAge: 0,
        avgBlockAge: 0
      };
      
      // Component stats
      const componentStatsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) > $1 THEN 1 END) as expired,
          COALESCE(SUM(file_size), 0) as total_size,
          COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at))), 0) as avg_age
        FROM components
      `;
      
      const componentRows = await executeQuery<any>(componentStatsQuery, [this.config.defaultTTL]);
      if (componentRows.length > 0) {
        const row = componentRows[0];
        stats.totalComponents = parseInt(row.total);
        stats.expiredComponents = parseInt(row.expired);
        stats.totalSize += parseInt(row.total_size) || 0;
        stats.avgComponentAge = parseFloat(row.avg_age) || 0;
      }
      
      // Block stats
      const blockStatsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at)) > $1 THEN 1 END) as expired,
          COALESCE(SUM(total_size), 0) as total_size,
          COALESCE(AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at))), 0) as avg_age
        FROM blocks
      `;
      
      const blockRows = await executeQuery<any>(blockStatsQuery, [this.config.defaultTTL]);
      if (blockRows.length > 0) {
        const row = blockRows[0];
        stats.totalBlocks = parseInt(row.total);
        stats.expiredBlocks = parseInt(row.expired);
        stats.totalSize += parseInt(row.total_size) || 0;
        stats.avgBlockAge = parseFloat(row.avg_age) || 0;
      }
      
      return stats;
    });
  }
  
  // Cache eviction strategy methods
  
  /**
   * Check if cache size exceeds the configured maximum and evict if necessary
   * @returns Number of items evicted
   */
  async enforceMaxSize(): Promise<number> {
    return this.wrapOperation('enforceMaxSize()', async () => {
      this.ensureNotDisposed();
      
      const currentSize = await this.getCurrentCacheSize();
      
      if (currentSize <= this.config.maxSize) {
        return 0; // No eviction needed
      }
      
      const bytesToEvict = currentSize - this.config.maxSize;
      return this.evictBySize(bytesToEvict);
    });
  }
  
  /**
   * Evict items to free up the specified number of bytes using LRU strategy
   * @param bytesToEvict Number of bytes to free up
   * @returns Number of items evicted
   */
  async evictBySize(bytesToEvict: number): Promise<number> {
    return this.wrapOperation(`evictBySize(${bytesToEvict} bytes)`, async () => {
      let evictedCount = 0;
      let bytesFreed = 0;
      
      await executeTransaction(async (tx) => {
        // Get items to evict ordered by LRU (least recently accessed first)
        const itemsToEvictQuery = `
          SELECT 'component' as type, framework, name, file_size as size, accessed_at
          FROM components
          UNION ALL
          SELECT 'block' as type, framework, name, total_size as size, accessed_at
          FROM blocks
          ORDER BY accessed_at ASC
        `;
        
        const candidateItemsResult = await tx.query(itemsToEvictQuery);
        const candidateItems = candidateItemsResult.rows as {
          type: string;
          framework: string;
          name: string;
          size: number;
          accessed_at: Date;
        }[];
        
        // Evict items until we've freed enough space
        for (const item of candidateItems) {
          if (bytesFreed >= bytesToEvict) {
            break;
          }
          
          const itemSize = item.size || 0;
          
          if (item.type === 'component') {
            const deleteQuery = 'DELETE FROM components WHERE framework = $1 AND name = $2';
            await tx.query(deleteQuery, [item.framework, item.name]);
          } else if (item.type === 'block') {
            const deleteQuery = 'DELETE FROM blocks WHERE framework = $1 AND name = $2';
            await tx.query(deleteQuery, [item.framework, item.name]);
          }
          
          bytesFreed += itemSize;
          evictedCount++;
          
          this.debug(`Evicted ${item.type}: ${item.framework}:${item.name} (${itemSize} bytes)`);
        }
      });
      
      if (evictedCount > 0) {
        this.debug(`Evicted ${evictedCount} items, freed ${bytesFreed} bytes`);
      }
      
      return evictedCount;
    });
  }
  
  /**
   * Evict the N least recently used items
   * @param itemCount Number of items to evict
   * @returns Number of items actually evicted
   */
  async evictLRU(itemCount: number): Promise<number> {
    return this.wrapOperation(`evictLRU(${itemCount} items)`, async () => {
      let evictedCount = 0;
      
      await executeTransaction(async (tx) => {
        // Get LRU items across both tables
        const lruItemsQuery = `
          SELECT 'component' as type, framework, name, accessed_at
          FROM components
          UNION ALL
          SELECT 'block' as type, framework, name, accessed_at
          FROM blocks
          ORDER BY accessed_at ASC
          LIMIT $1
        `;
        
        const lruItemsResult = await tx.query(lruItemsQuery, [itemCount]);
        const lruItems = lruItemsResult.rows as {
          type: string;
          framework: string;
          name: string;
          accessed_at: Date;
        }[];
        
        // Delete the LRU items
        for (const item of lruItems) {
          if (item.type === 'component') {
            const deleteQuery = 'DELETE FROM components WHERE framework = $1 AND name = $2';
            await tx.query(deleteQuery, [item.framework, item.name]);
          } else if (item.type === 'block') {
            const deleteQuery = 'DELETE FROM blocks WHERE framework = $1 AND name = $2';
            await tx.query(deleteQuery, [item.framework, item.name]);
          }
          
          evictedCount++;
          this.debug(`Evicted LRU ${item.type}: ${item.framework}:${item.name}`);
        }
      });
      
      if (evictedCount > 0) {
        this.debug(`Evicted ${evictedCount} LRU items`);
      }
      
      return evictedCount;
    });
  }
  
  /**
   * Get the current total cache size in bytes
   * @returns Total cache size in bytes
   */
  async getCurrentCacheSize(): Promise<number> {
    this.ensureNotDisposed();
    
    const query = `
      SELECT 
        (COALESCE((SELECT SUM(file_size) FROM components), 0) + 
         COALESCE((SELECT SUM(total_size) FROM blocks), 0)) as total_size
    `;
    
    const rows = await executeQuery<{total_size: number}>(query);
    
    const totalSize = rows[0]?.total_size || 0;
    
    return totalSize;
  }
  
  /**
   * Trigger a comprehensive cache maintenance operation
   * This includes cleaning up expired items and enforcing size limits
   * @returns Statistics about the maintenance operation
   */
  async performMaintenance(): Promise<{
    expiredCleaned: number;
    itemsEvicted: number;
    finalSize: number;
    finalCount: number;
  }> {
    return this.wrapOperation('performMaintenance()', async () => {
      this.ensureNotDisposed();
      
      // First clean up expired items
      const expiredCleaned = await this.cleanupExpired();
      
      // Then enforce size limits
      const itemsEvicted = await this.enforceMaxSize();
      
      // Get final statistics
      const finalSize = await this.getCurrentCacheSize();
      const finalCount = await this.size();
      
      this.debug(`Maintenance complete: ${expiredCleaned} expired cleaned, ${itemsEvicted} evicted, final size: ${finalSize} bytes, final count: ${finalCount}`);
      
      return {
        expiredCleaned,
        itemsEvicted,
        finalSize,
        finalCount
      };
    });
  }
  
  /**
   * Check if cache maintenance is needed
   * @returns True if maintenance is recommended
   */
  async needsMaintenance(): Promise<boolean> {
    this.ensureNotDisposed();
    
    const stats = await this.getCacheStats();
    const currentSize = await this.getCurrentCacheSize();
    
    // Maintenance needed if:
    // 1. Size exceeds 90% of max
    // 2. More than 10% of items are expired
    const sizeCritical = currentSize > (this.config.maxSize * 0.9);
    const expiredCritical = (stats.expiredComponents + stats.expiredBlocks) > ((stats.totalComponents + stats.totalBlocks) * 0.1);
    
    return sizeCritical || expiredCritical;
  }
}