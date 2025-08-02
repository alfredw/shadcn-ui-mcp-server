import { StorageMetadata, StorageProviderConfig } from '../interfaces/storage-provider.js';
import { BaseStorageProvider } from './base-storage-provider.js';
import { Cache } from '../../utils/cache.js';

interface CacheEntryMetadata {
  size: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  accessCount: number;
}

/**
 * Memory-based storage provider that wraps the existing Cache class
 */
export class MemoryStorageProvider extends BaseStorageProvider {
  private cache: Cache;
  private metadata: Map<string, CacheEntryMetadata>;
  private totalSize: number = 0;
  
  constructor(config: StorageProviderConfig = {}) {
    super(config);
    // Create a new cache instance instead of using the singleton
    // This allows for isolated testing and configuration
    this.cache = Cache.getInstance(this.config.defaultTTL * 1000); // Convert seconds to milliseconds
    this.metadata = new Map();
  }
  
  async get(key: string): Promise<any> {
    return this.wrapOperation(`get(${key})`, async () => {
      this.validateKey(key);
      
      const value = this.cache.get(key);
      
      if (value !== null) {
        // Update access metadata
        const meta = this.metadata.get(key);
        if (meta) {
          meta.accessedAt = new Date();
          meta.accessCount++;
        }
        
        this.debug(`Retrieved key: ${key}`);
        return value;
      }
      
      // If cache returned null, clean up metadata
      this.metadata.delete(key);
      return undefined;
    });
  }
  
  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.wrapOperation(`set(${key})`, async () => {
      this.validateKey(key);
      
      const size = this.calculateSize(value);
      
      // Check size limits
      if (this.totalSize - (this.metadata.get(key)?.size ?? 0) + size > this.config.maxSize) {
        throw new Error(`Storage limit exceeded. Cannot store key: ${key}`);
      }
      
      const effectiveTTL = ttl ?? this.config.defaultTTL;
      const ttlMs = effectiveTTL > 0 ? effectiveTTL * 1000 : 0; // Convert to milliseconds
      
      // Store in cache
      this.cache.set(key, value, ttlMs);
      
      // Update metadata
      const now = new Date();
      const existingMeta = this.metadata.get(key);
      
      if (existingMeta) {
        // Update existing entry
        this.totalSize = this.totalSize - existingMeta.size + size;
        existingMeta.size = size;
        existingMeta.updatedAt = now;
        existingMeta.accessedAt = now;
      } else {
        // New entry
        this.totalSize += size;
        this.metadata.set(key, {
          size,
          createdAt: now,
          updatedAt: now,
          accessedAt: now,
          accessCount: 0
        });
      }
      
      this.debug(`Stored key: ${key} (size: ${size} bytes)`);
    });
  }
  
  async has(key: string): Promise<boolean> {
    return this.wrapOperation(`has(${key})`, async () => {
      this.validateKey(key);
      
      const exists = this.cache.has(key);
      
      if (!exists) {
        // Clean up metadata if cache entry doesn't exist
        this.metadata.delete(key);
      }
      
      return exists;
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.wrapOperation(`delete(${key})`, async () => {
      this.validateKey(key);
      
      const meta = this.metadata.get(key);
      const deleted = this.cache.delete(key);
      
      if (deleted && meta) {
        this.totalSize -= meta.size;
        this.metadata.delete(key);
        this.debug(`Deleted key: ${key}`);
      }
      
      return deleted;
    });
  }
  
  async clear(): Promise<void> {
    return this.wrapOperation('clear()', async () => {
      this.cache.clear();
      this.metadata.clear();
      this.totalSize = 0;
      this.debug('Cleared all storage');
    });
  }
  
  async mget(keys: string[]): Promise<Map<string, any>> {
    return this.wrapOperation(`mget([${keys.length} keys])`, async () => {
      const result = new Map<string, any>();
      
      for (const key of keys) {
        const value = await this.get(key);
        if (value !== undefined) {
          result.set(key, value);
        }
      }
      
      return result;
    });
  }
  
  async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
    return this.wrapOperation(`mset([${entries.size} entries])`, async () => {
      for (const [key, value] of entries) {
        await this.set(key, value, ttl);
      }
    });
  }
  
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    return this.wrapOperation(`getMetadata(${key})`, async () => {
      this.validateKey(key);
      
      // Check if key exists in cache first
      if (!this.cache.has(key)) {
        this.metadata.delete(key);
        return null;
      }
      
      const meta = this.metadata.get(key);
      if (!meta) {
        return null;
      }
      
      return {
        key,
        size: meta.size,
        ttl: this.config.defaultTTL,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        accessedAt: meta.accessedAt,
        accessCount: meta.accessCount
      };
    });
  }
  
  async keys(pattern?: string): Promise<string[]> {
    return this.wrapOperation(`keys(${pattern ?? '*'})`, async () => {
      // Get all keys from metadata that still exist in cache
      const allKeys: string[] = [];
      
      for (const key of this.metadata.keys()) {
        if (this.cache.has(key)) {
          allKeys.push(key);
        } else {
          // Clean up stale metadata
          const meta = this.metadata.get(key);
          if (meta) {
            this.totalSize -= meta.size;
          }
          this.metadata.delete(key);
        }
      }
      
      return this.matchPattern(allKeys, pattern);
    });
  }
  
  async size(): Promise<number> {
    return this.wrapOperation('size()', async () => {
      // Clean up stale metadata and return accurate count
      let count = 0;
      
      for (const key of this.metadata.keys()) {
        if (this.cache.has(key)) {
          count++;
        } else {
          const meta = this.metadata.get(key);
          if (meta) {
            this.totalSize -= meta.size;
          }
          this.metadata.delete(key);
        }
      }
      
      return count;
    });
  }
  
  /**
   * Get the total size of stored data in bytes
   * @returns Total size in bytes
   */
  async getTotalSize(): Promise<number> {
    await this.size(); // This will clean up stale metadata
    return this.totalSize;
  }
  
  /**
   * Get configuration for this provider
   * @returns Provider configuration
   */
  getConfig(): Required<StorageProviderConfig> {
    return { ...this.config };
  }
  
  /**
   * Clean up expired entries
   * @returns Number of entries cleaned up
   */
  async cleanup(): Promise<number> {
    return this.wrapOperation('cleanup()', async () => {
      const initialSize = await this.size();
      
      // The cache automatically handles expiration, but we need to clean up metadata
      await this.size();
      
      const finalSize = await this.size();
      const cleaned = initialSize - finalSize;
      
      if (cleaned > 0) {
        this.debug(`Cleaned up ${cleaned} expired entries`);
      }
      
      return cleaned;
    });
  }
}