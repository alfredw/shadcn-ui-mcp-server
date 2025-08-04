/**
 * Configuration schemas and type definitions
 */

import { z } from 'zod';

/**
 * Alert configuration for monitoring
 */
export interface AlertConfig {
  name: string;
  condition: string;
  threshold: number;
  enabled: boolean;
}

/**
 * Comprehensive cache configuration interface
 */
export interface CacheConfiguration {
  // Storage configuration
  storage: {
    type: 'hybrid' | 'memory-only' | 'pglite-only';
    memory?: {
      enabled: boolean;
      maxSize: number;        // bytes
      ttl: number;           // seconds
      evictionPolicy: 'lru' | 'lfu' | 'fifo';
    };
    pglite?: {
      enabled: boolean;
      path?: string;         // Custom database path
      maxSize: number;       // bytes
      enableWAL: boolean;
      busyTimeout: number;   // ms
      vacuumInterval: number; // hours
    };
    github?: {
      enabled: boolean;
      token?: string;
      baseUrl: string;
      timeout: number;       // ms
      retries: number;
      userAgent?: string;
    };
  };
  
  // Cache behavior
  cache: {
    strategy: 'write-through' | 'write-behind' | 'read-through' | 'cache-aside';
    ttl: {
      components: number;    // seconds
      blocks: number;        // seconds
      metadata: number;      // seconds
    };
    prefetch: {
      enabled: boolean;
      popular: boolean;      // Prefetch popular items
      related: boolean;      // Prefetch related items
    };
    compression: {
      enabled: boolean;
      algorithm: 'gzip' | 'brotli' | 'none';
      level: number;         // 1-9
    };
  };
  
  // Performance settings
  performance: {
    batchSize: number;       // Batch operations size
    concurrency: number;     // Max concurrent operations
    queueSize: number;       // Write-behind queue size
    flushInterval: number;   // ms
  };
  
  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    statsInterval: number;   // ms
    metricsRetention: number; // days
    exporters: {
      prometheus: boolean;
      json: boolean;
    };
    alerts: AlertConfig[];
  };
  
  // Circuit breaker
  circuitBreaker: {
    enabled: boolean;
    threshold: number;       // failure count
    timeout: number;         // ms
    resetTimeout: number;    // ms
  };
  
  // Feature flags
  features: {
    offlineMode: boolean;
    migration: boolean;
    analytics: boolean;
    autoSync: boolean;
    experimentalFeatures: string[];
  };
}

/**
 * Configuration source interface
 */
export interface ConfigSource {
  load(): Promise<Partial<CacheConfiguration>>;
  name: string;
  priority: number; // Higher number = higher priority
}

/**
 * Configuration validator interface
 */
export interface ConfigValidator {
  validate(config: Partial<CacheConfiguration>): ValidationResult;
  name: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Configuration watcher callback
 */
export type ConfigWatcher = (newValue: any, oldValue?: any, path?: string) => void;

/**
 * Zod schema for configuration validation
 */
export const alertConfigSchema = z.object({
  name: z.string().min(1),
  condition: z.string().min(1),
  threshold: z.number().positive(),
  enabled: z.boolean()
});

export const cacheConfigurationSchema = z.object({
  storage: z.object({
    type: z.enum(['hybrid', 'memory-only', 'pglite-only']),
    memory: z.object({
      enabled: z.boolean(),
      maxSize: z.number().positive(),
      ttl: z.number().nonnegative(),
      evictionPolicy: z.enum(['lru', 'lfu', 'fifo'])
    }).optional(),
    pglite: z.object({
      enabled: z.boolean(),
      path: z.string().optional(),
      maxSize: z.number().positive(),
      enableWAL: z.boolean(),
      busyTimeout: z.number().positive(),
      vacuumInterval: z.number().positive()
    }).optional(),
    github: z.object({
      enabled: z.boolean(),
      token: z.string().optional(),
      baseUrl: z.string().url(),
      timeout: z.number().positive(),
      retries: z.number().nonnegative(),
      userAgent: z.string().optional()
    }).optional()
  }),
  
  cache: z.object({
    strategy: z.enum(['write-through', 'write-behind', 'read-through', 'cache-aside']),
    ttl: z.object({
      components: z.number().positive(),
      blocks: z.number().positive(),
      metadata: z.number().positive()
    }),
    prefetch: z.object({
      enabled: z.boolean(),
      popular: z.boolean(),
      related: z.boolean()
    }),
    compression: z.object({
      enabled: z.boolean(),
      algorithm: z.enum(['gzip', 'brotli', 'none']),
      level: z.number().int().min(1).max(9)
    })
  }),
  
  performance: z.object({
    batchSize: z.number().positive(),
    concurrency: z.number().positive(),
    queueSize: z.number().positive(),
    flushInterval: z.number().positive()
  }),
  
  monitoring: z.object({
    enabled: z.boolean(),
    statsInterval: z.number().positive(),
    metricsRetention: z.number().positive(),
    exporters: z.object({
      prometheus: z.boolean(),
      json: z.boolean()
    }),
    alerts: z.array(alertConfigSchema)
  }),
  
  circuitBreaker: z.object({
    enabled: z.boolean(),
    threshold: z.number().positive(),
    timeout: z.number().positive(),
    resetTimeout: z.number().positive()
  }),
  
  features: z.object({
    offlineMode: z.boolean(),
    migration: z.boolean(),
    analytics: z.boolean(),
    autoSync: z.boolean(),
    experimentalFeatures: z.array(z.string())
  })
});

/**
 * Partial configuration schema for loading from sources
 */
export const partialCacheConfigurationSchema = cacheConfigurationSchema.deepPartial();