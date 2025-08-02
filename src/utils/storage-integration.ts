/**
 * Storage integration layer for the MCP server
 * Provides a unified interface for caching with automatic fallback
 */

import { 
  HybridStorageProvider, 
  CacheStrategy, 
  type HybridStorageConfig 
} from '../storage/index.js';
import { logError, logInfo, logWarning } from './logger.js';

/**
 * Global storage instance for the MCP server
 */
let globalStorage: HybridStorageProvider | null = null;

/**
 * Storage configuration based on environment variables
 */
function getStorageConfig(): HybridStorageConfig {
  return {
    memory: {
      enabled: true,
      maxSize: parseInt(process.env.STORAGE_MEMORY_MAX_SIZE || '') || 50 * 1024 * 1024, // 50MB default
      ttl: parseInt(process.env.STORAGE_MEMORY_TTL || '') || 3600 // 1 hour default
    },
    pglite: {
      enabled: process.env.STORAGE_PGLITE_ENABLED !== 'false', // Enable by default
      maxSize: parseInt(process.env.STORAGE_PGLITE_MAX_SIZE || '') || 100 * 1024 * 1024, // 100MB default
      ttl: parseInt(process.env.STORAGE_PGLITE_TTL || '') || 24 * 3600 // 24 hours default
    },
    github: {
      enabled: process.env.STORAGE_GITHUB_ENABLED !== 'false', // Enable by default
      apiKey: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '',
      timeout: parseInt(process.env.STORAGE_GITHUB_TIMEOUT || '') || 30000 // 30 seconds default
    },
    strategy: (process.env.STORAGE_STRATEGY as CacheStrategy) || CacheStrategy.READ_THROUGH,
    circuitBreaker: {
      threshold: parseInt(process.env.STORAGE_CIRCUIT_BREAKER_THRESHOLD || '') || 5,
      timeout: parseInt(process.env.STORAGE_CIRCUIT_BREAKER_TIMEOUT || '') || 60000, // 1 minute
      successThreshold: parseInt(process.env.STORAGE_CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '') || 2
    },
    debug: process.env.LOG_LEVEL === 'debug' || process.env.STORAGE_DEBUG === 'true'
  };
}

/**
 * Initialize the global storage instance
 */
export async function initializeStorage(): Promise<void> {
  if (globalStorage) {
    logWarning('Storage already initialized');
    return;
  }

  try {
    const config = getStorageConfig();
    globalStorage = new HybridStorageProvider(config);
    
    logInfo(`Storage initialized successfully - strategy: ${config.strategy}, memory: ${config.memory?.enabled}, pglite: ${config.pglite?.enabled}, github: ${config.github?.enabled}`);
    
    // Log configuration for debugging
    if (config.debug) {
      const hybridConfig = globalStorage.getHybridConfig();
      logInfo(`Storage configuration: ${JSON.stringify(hybridConfig, null, 2)}`);
    }
    
  } catch (error) {
    logError('Failed to initialize storage', error);
    throw error;
  }
}

/**
 * Get the global storage instance
 */
export function getStorage(): HybridStorageProvider {
  if (!globalStorage) {
    throw new Error('Storage not initialized. Call initializeStorage() first.');
  }
  return globalStorage;
}

/**
 * Check if storage is initialized
 */
export function isStorageInitialized(): boolean {
  return globalStorage !== null && !globalStorage.isDisposed();
}

/**
 * Dispose of the global storage instance
 */
export async function disposeStorage(): Promise<void> {
  if (globalStorage && !globalStorage.isDisposed()) {
    await globalStorage.dispose();
    globalStorage = null;
    logInfo('Storage disposed');
  }
}

/**
 * Get cached data with automatic fallback to provided fetch function
 * This is the main interface for tool handlers to use caching
 */
export async function getCachedData<T>(
  key: string,
  fetchFunction: () => Promise<T>,
  ttl?: number
): Promise<T> {
  if (!isStorageInitialized()) {
    logWarning('Storage not initialized, using direct fetch');
    return await fetchFunction();
  }

  const storage = getStorage();
  
  try {
    // Try to get from cache first
    const cached = await storage.get(key);
    if (cached !== undefined) {
      logInfo(`Cache hit for key: ${key}`);
      return cached;
    }
    
    // Cache miss - fetch fresh data
    logInfo(`Cache miss for key: ${key}, fetching fresh data`);
    const freshData = await fetchFunction();
    
    // Store in cache for future use
    await storage.set(key, freshData, ttl);
    
    return freshData;
    
  } catch (error) {
    logError(`Error in getCachedData for key ${key}`, error);
    
    // Fallback to direct fetch if caching fails
    logWarning(`Falling back to direct fetch for key: ${key}`);
    return await fetchFunction();
  }
}

/**
 * Get multiple cached items with batch optimization
 */
export async function getCachedDataBatch<T>(
  requests: Array<{
    key: string;
    fetchFunction: () => Promise<T>;
    ttl?: number;
  }>
): Promise<Map<string, T>> {
  if (!isStorageInitialized()) {
    logWarning('Storage not initialized, using direct fetch for batch');
    const results = new Map<string, T>();
    
    for (const request of requests) {
      try {
        const data = await request.fetchFunction();
        results.set(request.key, data);
      } catch (error) {
        logError(`Error fetching ${request.key}`, error);
      }
    }
    
    return results;
  }

  const storage = getStorage();
  const results = new Map<string, T>();
  const keysToFetch: typeof requests = [];
  
  try {
    // Try batch get from cache
    const keys = requests.map(r => r.key);
    const cached = await storage.mget(keys);
    
    // Separate cache hits and misses
    for (const request of requests) {
      if (cached.has(request.key)) {
        results.set(request.key, cached.get(request.key));
      } else {
        keysToFetch.push(request);
      }
    }
    
    logInfo(`Batch cache stats: ${cached.size} hits, ${keysToFetch.length} misses`);
    
    // Fetch missing data
    const fetchPromises = keysToFetch.map(async (request) => {
      try {
        const data = await request.fetchFunction();
        results.set(request.key, data);
        
        // Cache the result
        await storage.set(request.key, data, request.ttl);
        
      } catch (error) {
        logError(`Error fetching ${request.key}`, error);
      }
    });
    
    await Promise.allSettled(fetchPromises);
    
  } catch (error) {
    logError('Error in getCachedDataBatch', error);
    
    // Fallback to individual fetches
    logWarning('Falling back to individual fetches');
    for (const request of requests) {
      try {
        const data = await request.fetchFunction();
        results.set(request.key, data);
      } catch (error) {
        logError(`Error fetching ${request.key}`, error);
      }
    }
  }
  
  return results;
}

/**
 * Invalidate cached data by key or pattern
 */
export async function invalidateCache(keyOrPattern: string): Promise<boolean> {
  if (!isStorageInitialized()) {
    return false;
  }

  const storage = getStorage();
  
  try {
    if (keyOrPattern.includes('*') || keyOrPattern.includes('?')) {
      // Pattern-based invalidation
      const keys = await storage.keys(keyOrPattern);
      const promises = keys.map(key => storage.delete(key));
      const results = await Promise.allSettled(promises);
      const deletedCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      
      logInfo(`Invalidated ${deletedCount} cached items matching pattern: ${keyOrPattern}`);
      return deletedCount > 0;
    } else {
      // Single key invalidation
      const deleted = await storage.delete(keyOrPattern);
      if (deleted) {
        logInfo(`Invalidated cached item: ${keyOrPattern}`);
      }
      return deleted;
    }
  } catch (error) {
    logError(`Error invalidating cache for ${keyOrPattern}`, error);
    return false;
  }
}

/**
 * Get storage statistics for monitoring
 */
export function getStorageStats() {
  if (!isStorageInitialized()) {
    return null;
  }

  const storage = getStorage();
  return storage.getStats();
}

/**
 * Get circuit breaker status
 */
export function getCircuitBreakerStatus() {
  if (!isStorageInitialized()) {
    return null;
  }

  const storage = getStorage();
  return storage.getCircuitBreakerStatus();
}

/**
 * Utility function to generate cache keys for components
 */
export function generateComponentKey(componentName: string, framework = 'react'): string {
  return `component:${framework}:${componentName}`;
}

/**
 * Utility function to generate cache keys for component demos
 */
export function generateComponentDemoKey(componentName: string, framework = 'react'): string {
  return `component-demo:${framework}:${componentName}`;
}

/**
 * Utility function to generate cache keys for component metadata
 */
export function generateComponentMetadataKey(componentName: string, framework = 'react'): string {
  return `component-metadata:${framework}:${componentName}`;
}

/**
 * Utility function to generate cache keys for blocks
 */
export function generateBlockKey(blockName: string, includeComponents = true, framework = 'react'): string {
  return `block:${framework}:${blockName}:components-${includeComponents}`;
}

/**
 * Utility function to generate cache keys for lists
 */
export function generateListKey(type: 'components' | 'blocks', framework = 'react', category?: string): string {
  const base = `list:${type}:${framework}`;
  return category ? `${base}:${category}` : base;
}

/**
 * Utility function to generate cache keys for directory structure
 */
export function generateDirectoryKey(path?: string, owner = 'shadcn-ui', repo = 'ui', branch = 'main'): string {
  const normalizedPath = path || 'root';
  return `directory:${owner}:${repo}:${branch}:${normalizedPath}`;
}