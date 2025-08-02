import { StorageProvider, StorageMetadata, StorageProviderConfig } from '../interfaces/storage-provider.js';
import { logError, logWarning, logInfo } from '../../utils/logger.js';

/**
 * Base abstract class for storage providers with common functionality
 */
export abstract class BaseStorageProvider implements StorageProvider {
  protected config: Required<StorageProviderConfig>;
  protected disposed = false;
  
  constructor(config: StorageProviderConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100 * 1024 * 1024, // 100MB default
      defaultTTL: config.defaultTTL ?? 3600, // 1 hour default
      debug: config.debug ?? false
    };
  }
  
  /**
   * Validate a storage key
   * @param key Key to validate
   * @throws Error if key is invalid
   */
  protected validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    if (key.length > 255) {
      throw new Error('Storage key must not exceed 255 characters');
    }
    // Disallow certain characters that might cause issues
    if (/[\x00-\x1f\x7f]/.test(key)) {
      throw new Error('Storage key contains invalid control characters');
    }
  }
  
  /**
   * Calculate TTL expiration timestamp
   * @param ttl TTL in seconds
   * @returns Expiration timestamp or undefined for no expiration
   */
  protected calculateExpiration(ttl?: number): number | undefined {
    const effectiveTTL = ttl ?? this.config.defaultTTL;
    if (effectiveTTL <= 0) {
      return undefined;
    }
    return Date.now() + (effectiveTTL * 1000);
  }
  
  /**
   * Check if an item has expired
   * @param expiration Expiration timestamp
   * @returns True if expired
   */
  protected isExpired(expiration?: number): boolean {
    if (!expiration) {
      return false;
    }
    return Date.now() > expiration;
  }
  
  /**
   * Calculate the size of a value in bytes
   * @param value Value to measure
   * @returns Size in bytes
   */
  protected calculateSize(value: any): number {
    const str = JSON.stringify(value);
    return Buffer.byteLength(str, 'utf8');
  }
  
  /**
   * Log debug information if debug mode is enabled
   * @param message Debug message
   */
  protected debug(message: string): void {
    if (this.config.debug) {
      logInfo(`[StorageProvider] ${message}`);
    }
  }
  
  /**
   * Wrap an async operation with error handling
   * @param operation Operation name for logging
   * @param fn Function to execute
   * @returns Result of the function
   */
  protected async wrapOperation<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      this.ensureNotDisposed();
      const start = Date.now();
      const result = await fn();
      const duration = Date.now() - start;
      
      if (duration > 100) {
        logWarning(`Slow storage operation: ${operation} took ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      logError(`Storage operation failed: ${operation}`, error);
      throw error;
    }
  }
  
  /**
   * Match keys against a glob pattern
   * @param keys Array of keys to filter
   * @param pattern Glob pattern (supports * wildcard)
   * @returns Filtered keys
   */
  protected matchPattern(keys: string[], pattern?: string): string[] {
    if (!pattern) {
      return keys;
    }
    
    // Convert glob pattern to regex
    // Escape special regex characters except *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return keys.filter(key => regex.test(key));
  }
  
  /**
   * Guard against operations on disposed provider
   * @throws Error if provider has been disposed
   */
  protected ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Storage provider has been disposed and cannot be used');
    }
  }
  
  /**
   * Default disposal implementation - subclasses can override for custom cleanup
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    this.debug('Disposing storage provider');
    this.disposed = true;
  }
  
  /**
   * Check if provider has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
  
  // Abstract methods that must be implemented by subclasses
  abstract get(key: string): Promise<any>;
  abstract set(key: string, value: any, ttl?: number): Promise<void>;
  abstract has(key: string): Promise<boolean>;
  abstract delete(key: string): Promise<boolean>;
  abstract clear(): Promise<void>;
  abstract mget(keys: string[]): Promise<Map<string, any>>;
  abstract mset(entries: Map<string, any>, ttl?: number): Promise<void>;
  abstract getMetadata(key: string): Promise<StorageMetadata | null>;
  abstract keys(pattern?: string): Promise<string[]>;
  abstract size(): Promise<number>;
}