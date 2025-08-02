/**
 * Metadata associated with a stored item
 */
export interface StorageMetadata {
  /**
   * The key of the stored item
   */
  key: string;
  
  /**
   * Size of the stored value in bytes
   */
  size: number;
  
  /**
   * Time to live in seconds
   */
  ttl?: number;
  
  /**
   * When the item was first created
   */
  createdAt: Date;
  
  /**
   * When the item was last updated
   */
  updatedAt: Date;
  
  /**
   * When the item was last accessed
   */
  accessedAt: Date;
  
  /**
   * Number of times the item has been accessed
   */
  accessCount: number;
}

/**
 * Common interface for all storage providers
 */
export interface StorageProvider {
  /**
   * Get a value by key
   * @param key The key to retrieve
   * @returns The stored value or undefined if not found
   */
  get(key: string): Promise<any>;
  
  /**
   * Store a value with optional TTL
   * @param key The key to store under
   * @param value The value to store
   * @param ttl Time to live in seconds
   */
  set(key: string, value: any, ttl?: number): Promise<void>;
  
  /**
   * Check if a key exists
   * @param key The key to check
   * @returns True if the key exists
   */
  has(key: string): Promise<boolean>;
  
  /**
   * Delete a key
   * @param key The key to delete
   * @returns True if the key was deleted, false if it didn't exist
   */
  delete(key: string): Promise<boolean>;
  
  /**
   * Clear all stored data
   */
  clear(): Promise<void>;
  
  /**
   * Get multiple values at once
   * @param keys Array of keys to retrieve
   * @returns Map of key-value pairs
   */
  mget(keys: string[]): Promise<Map<string, any>>;
  
  /**
   * Set multiple values at once
   * @param entries Map of key-value pairs to store
   * @param ttl Optional TTL to apply to all entries
   */
  mset(entries: Map<string, any>, ttl?: number): Promise<void>;
  
  /**
   * Get metadata for a key
   * @param key The key to get metadata for
   * @returns Metadata or null if key doesn't exist
   */
  getMetadata(key: string): Promise<StorageMetadata | null>;
  
  /**
   * Get all keys matching a pattern
   * @param pattern Optional glob pattern (e.g., "component:*")
   * @returns Array of matching keys
   */
  keys(pattern?: string): Promise<string[]>;
  
  /**
   * Get the total number of stored items
   * @returns Number of items
   */
  size(): Promise<number>;
  
  /**
   * Dispose of all resources and close connections
   * @returns Promise that resolves when cleanup is complete
   */
  dispose(): Promise<void>;
  
  /**
   * Check if the provider has been disposed
   * @returns True if disposed, false otherwise
   */
  isDisposed(): boolean;
}

/**
 * Configuration options for storage providers
 */
export interface StorageProviderConfig {
  /**
   * Maximum storage size in bytes
   */
  maxSize?: number;
  
  /**
   * Default TTL in seconds for items without explicit TTL
   */
  defaultTTL?: number;
  
  /**
   * Whether to enable debug logging
   */
  debug?: boolean;
}