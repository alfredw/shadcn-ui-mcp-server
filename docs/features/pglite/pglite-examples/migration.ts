/**
 * Migration Strategy: From In-Memory Cache to PGLite
 * This file demonstrates how to migrate from the current in-memory cache to PGLite
 */

import { PGLite } from '@electric-sql/pglite';
import { Cache } from '../../../src/utils/cache';
import { PGLiteStorage, HybridStorage } from './cache-interface';
import { logInfo, logWarning, logError } from '../../../src/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Migration Manager
 * Handles the transition from in-memory cache to PGLite storage
 */
export class CacheMigrationManager {
  private oldCache: Cache;
  private newStorage: PGLiteStorage;
  private config: MigrationConfig;

  constructor(config?: Partial<MigrationConfig>) {
    this.oldCache = Cache.getInstance();
    this.newStorage = new PGLiteStorage(config?.dbPath);
    this.config = {
      preserveOldCache: false,
      migrateStatistics: true,
      batchSize: 50,
      ...config
    };
  }

  /**
   * Perform the migration
   */
  async migrate(): Promise<MigrationResult> {
    logInfo('Starting cache migration to PGLite...');
    const result: MigrationResult = {
      startTime: new Date(),
      componentsCount: 0,
      blocksCount: 0,
      errors: [],
      warnings: []
    };

    try {
      // Initialize PGLite
      await this.newStorage.initialize();

      // Export current cache data
      const cacheData = await this.exportInMemoryCache();
      result.totalItems = cacheData.items.length;

      // Migrate in batches
      for (let i = 0; i < cacheData.items.length; i += this.config.batchSize) {
        const batch = cacheData.items.slice(i, i + this.config.batchSize);
        await this.migrateBatch(batch, result);
        
        // Progress update
        const progress = Math.round((i + batch.length) / cacheData.items.length * 100);
        logInfo(`Migration progress: ${progress}% (${i + batch.length}/${cacheData.items.length})`);
      }

      // Migrate metadata
      if (this.config.migrateStatistics) {
        await this.migrateMetadata(cacheData.metadata);
      }

      // Verify migration
      const verified = await this.verifyMigration(result);
      if (!verified) {
        result.warnings.push('Migration verification failed - some items may not have been migrated correctly');
      }

      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();

      logInfo(`Migration completed: ${result.componentsCount} components, ${result.blocksCount} blocks migrated in ${result.duration}ms`);

      // Clean up old cache if requested
      if (!this.config.preserveOldCache) {
        this.oldCache.clear();
        logInfo('Old cache cleared');
      }

      return result;
    } catch (error) {
      logError('Migration failed', error);
      result.errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Export current in-memory cache data
   */
  private async exportInMemoryCache(): Promise<CacheExport> {
    const items: CacheItem[] = [];
    const metadata: Record<string, any> = {};

    // Access the internal storage (this is a workaround - in real implementation,
    // the Cache class should expose an export method)
    const cacheStorage = (this.oldCache as any).storage as Map<string, any>;

    for (const [key, value] of cacheStorage.entries()) {
      // Parse the key to determine type
      const keyParts = this.parseKey(key);
      if (keyParts) {
        items.push({
          key,
          type: keyParts.type,
          framework: keyParts.framework,
          name: keyParts.name,
          value: value.value,
          timestamp: value.timestamp,
          ttl: value.ttl
        });
      }
    }

    // Collect metadata
    metadata.exportTime = new Date().toISOString();
    metadata.itemCount = items.length;
    metadata.cacheVersion = '1.0.0';

    return { items, metadata };
  }

  /**
   * Migrate a batch of items
   */
  private async migrateBatch(items: CacheItem[], result: MigrationResult): Promise<void> {
    for (const item of items) {
      try {
        await this.migrateItem(item);
        
        if (item.type === 'component') {
          result.componentsCount++;
        } else if (item.type === 'block') {
          result.blocksCount++;
        }
      } catch (error) {
        const errorMsg = `Failed to migrate ${item.key}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        logWarning(errorMsg);
      }
    }
  }

  /**
   * Migrate a single cache item
   */
  private async migrateItem(item: CacheItem): Promise<void> {
    // Calculate remaining TTL
    const now = Date.now();
    const elapsed = now - item.timestamp;
    const remainingTtl = Math.max(0, item.ttl - elapsed);

    if (remainingTtl === 0) {
      // Item has expired, skip it
      return;
    }

    // Convert TTL to seconds for PGLite
    const ttlSeconds = Math.floor(remainingTtl / 1000);

    // Reconstruct the key for PGLite storage
    const key = `${item.framework}:${item.type}:${item.name}`;

    // Set in new storage with adjusted TTL
    await this.newStorage.set(key, item.value, ttlSeconds);
  }

  /**
   * Migrate metadata
   */
  private async migrateMetadata(metadata: Record<string, any>): Promise<void> {
    // This would update cache_metadata table with migration info
    logInfo('Migrating metadata...', metadata);
  }

  /**
   * Verify migration was successful
   */
  private async verifyMigration(result: MigrationResult): Promise<boolean> {
    try {
      const stats = await this.newStorage.getStats();
      const totalMigrated = result.componentsCount + result.blocksCount;
      
      // Check if counts match (approximately, due to expired items)
      const tolerance = 0.95; // Allow 5% difference due to expired items
      const actualCount = stats.storage.reduce((sum: number, item: any) => sum + item.total_count, 0);
      
      return actualCount >= totalMigrated * tolerance;
    } catch (error) {
      logWarning('Failed to verify migration', error);
      return false;
    }
  }

  /**
   * Parse cache key to extract components
   */
  private parseKey(key: string): { framework: string; type: string; name: string } | null {
    // Try different key formats that might be used in the current cache
    
    // Format 1: "framework:type:name"
    const format1Match = key.match(/^(\w+):(component|block):(.+)$/);
    if (format1Match) {
      return {
        framework: format1Match[1],
        type: format1Match[2],
        name: format1Match[3]
      };
    }

    // Format 2: "get_component_framework_name"
    const format2Match = key.match(/^get_(component|block)_(\w+)_(.+)$/);
    if (format2Match) {
      return {
        framework: format2Match[2],
        type: format2Match[1],
        name: format2Match[3]
      };
    }

    // Format 3: Simple "component_name" (assume react)
    const format3Match = key.match(/^([\w-]+)$/);
    if (format3Match) {
      return {
        framework: 'react',
        type: 'component',
        name: format3Match[1]
      };
    }

    return null;
  }
}

/**
 * Gradual Migration Strategy
 * Allows running both storage systems in parallel during transition
 */
export class GradualMigrationAdapter {
  private hybridStorage: HybridStorage;
  private migrationProgress: MigrationProgress;
  private config: GradualMigrationConfig;

  constructor(config?: Partial<GradualMigrationConfig>) {
    this.hybridStorage = new HybridStorage(config?.dbPath);
    this.config = {
      readFromPGLite: true,
      writeToBoath: true,
      migrationRate: 0.1, // Migrate 10% of cache misses
      ...config
    };
    this.migrationProgress = {
      startTime: new Date(),
      itemsMigrated: 0,
      readPreference: 'both'
    };
  }

  async initialize(): Promise<void> {
    await this.hybridStorage.initialize();
    await this.loadProgress();
  }

  /**
   * Get with gradual migration
   */
  async get(key: string): Promise<any | null> {
    const stats = { source: 'none', migrated: false };

    // Try hybrid storage first
    const value = await this.hybridStorage.get(key);
    if (value !== null) {
      stats.source = 'hybrid';
      return value;
    }

    // Check old cache as fallback
    const oldCache = Cache.getInstance();
    const oldValue = oldCache.get(key);
    
    if (oldValue !== null) {
      stats.source = 'old_cache';
      
      // Gradually migrate based on rate
      if (Math.random() < this.config.migrationRate) {
        await this.hybridStorage.set(key, oldValue);
        stats.migrated = true;
        this.migrationProgress.itemsMigrated++;
      }
      
      return oldValue;
    }

    return null;
  }

  /**
   * Set with dual writing
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (this.config.writeToBoath) {
      // Write to both storages
      const oldCache = Cache.getInstance();
      oldCache.set(key, value, ttl);
      await this.hybridStorage.set(key, value, ttl);
    } else {
      // Write only to new storage
      await this.hybridStorage.set(key, value, ttl);
    }
  }

  /**
   * Get migration progress
   */
  async getProgress(): Promise<MigrationProgress> {
    return this.migrationProgress;
  }

  /**
   * Complete migration
   */
  async completeMigration(): Promise<void> {
    logInfo('Completing gradual migration...');
    
    // Migrate all remaining items
    const oldCache = Cache.getInstance();
    const cacheStorage = (oldCache as any).storage as Map<string, any>;
    
    for (const [key, value] of cacheStorage.entries()) {
      const exists = await this.hybridStorage.get(key);
      if (!exists) {
        await this.hybridStorage.set(key, value.value, value.ttl);
        this.migrationProgress.itemsMigrated++;
      }
    }
    
    // Clear old cache
    oldCache.clear();
    
    // Update configuration
    this.config.readFromPGLite = true;
    this.config.writeToBoath = false;
    
    await this.saveProgress();
    logInfo('Gradual migration completed');
  }

  private async loadProgress(): Promise<void> {
    // Load progress from file or database
    try {
      const progressFile = path.join(process.cwd(), '.migration-progress.json');
      const data = await fs.readFile(progressFile, 'utf-8');
      this.migrationProgress = JSON.parse(data);
    } catch (error) {
      // Progress file doesn't exist, use defaults
    }
  }

  private async saveProgress(): Promise<void> {
    // Save progress to file
    try {
      const progressFile = path.join(process.cwd(), '.migration-progress.json');
      await fs.writeFile(progressFile, JSON.stringify(this.migrationProgress, null, 2));
    } catch (error) {
      logWarning('Failed to save migration progress', error);
    }
  }
}

// Type definitions

interface MigrationConfig {
  preserveOldCache: boolean;
  migrateStatistics: boolean;
  batchSize: number;
  dbPath?: string;
}

interface MigrationResult {
  startTime: Date;
  endTime?: Date;
  duration?: number;
  totalItems?: number;
  componentsCount: number;
  blocksCount: number;
  errors: string[];
  warnings: string[];
}

interface CacheItem {
  key: string;
  type: string;
  framework: string;
  name: string;
  value: any;
  timestamp: number;
  ttl: number;
}

interface CacheExport {
  items: CacheItem[];
  metadata: Record<string, any>;
}

interface GradualMigrationConfig {
  readFromPGLite: boolean;
  writeToBoath: boolean;
  migrationRate: number;
  dbPath?: string;
}

interface MigrationProgress {
  startTime: Date;
  itemsMigrated: number;
  readPreference: 'old' | 'new' | 'both';
}

/**
 * Example usage:
 * 
 * // One-time migration
 * const migrator = new CacheMigrationManager();
 * await migrator.migrate();
 * 
 * // Gradual migration
 * const gradualMigrator = new GradualMigrationAdapter({
 *   migrationRate: 0.2 // Migrate 20% of cache misses
 * });
 * await gradualMigrator.initialize();
 * 
 * // Use it as a drop-in replacement
 * const value = await gradualMigrator.get('react:component:button');
 * await gradualMigrator.set('react:component:card', cardData);
 * 
 * // Complete migration when ready
 * await gradualMigrator.completeMigration();
 */