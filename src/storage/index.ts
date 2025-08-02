// Interfaces
export type { StorageProvider, StorageMetadata, StorageProviderConfig } from './interfaces/storage-provider.js';
export type { 
  ParsedKey, 
  Component, 
  ComponentMetadata, 
  Block, 
  BlockMetadata 
} from './providers/pglite-storage-provider.js';

// Base classes
export { BaseStorageProvider } from './providers/base-storage-provider.js';

// Concrete implementations
export { MemoryStorageProvider } from './providers/memory-storage-provider.js';
export { PGLiteStorageProvider } from './providers/pglite-storage-provider.js';
export { GitHubStorageProvider } from './providers/github-storage-provider.js';

// Hybrid storage orchestrator
export { HybridStorageProvider } from './hybrid/hybrid-storage.js';
export { StorageCircuitBreaker } from './hybrid/storage-circuit-breaker.js';
export { 
  CacheStrategy, 
  type HybridStorageConfig, 
  type HybridStorageStats,
  DEFAULT_HYBRID_CONFIG,
  createDefaultStats,
  calculateHitRate,
  calculateAverageResponseTime
} from './hybrid/cache-strategies.js';

// Database infrastructure
export { PGLiteManager } from './database/manager.js';
export { initializeDatabase, getDatabase, getDatabaseManager, closeDatabase } from './database/connection.js';