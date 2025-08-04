/**
 * Cache strategy definitions for hybrid storage orchestrator
 */

/**
 * Available cache strategies for hybrid storage
 */
export enum CacheStrategy {
  /**
   * Write to all layers synchronously
   * Provides strong consistency but higher latency
   */
  WRITE_THROUGH = 'write-through',
  
  /**
   * Write to L1 immediately, async to others
   * Provides low latency with eventual consistency
   */
  WRITE_BEHIND = 'write-behind',
  
  /**
   * Read misses populate cache automatically
   * Default strategy for most use cases
   */
  READ_THROUGH = 'read-through',
  
  /**
   * Application manages cache explicitly
   * Only write to cache layers, not source
   */
  CACHE_ASIDE = 'cache-aside'
}

/**
 * Configuration for hybrid storage behavior
 */
export interface HybridStorageConfig {
  /**
   * Memory storage configuration (L1 cache)
   */
  memory?: {
    maxSize?: number;
    ttl?: number;
    enabled?: boolean;
  };
  
  /**
   * PGLite storage configuration (L2 cache)
   */
  pglite?: {
    maxSize?: number;
    ttl?: number;
    enabled?: boolean;
  };
  
  /**
   * GitHub storage configuration (L3 source)
   */
  github?: {
    enabled?: boolean;
    apiKey?: string;
    timeout?: number;
  };
  
  /**
   * Cache strategy to use
   */
  strategy?: CacheStrategy;
  
  /**
   * Circuit breaker configuration for GitHub API
   */
  circuitBreaker?: {
    threshold?: number;
    timeout?: number;
    successThreshold?: number;
  };
  
  /**
   * Debug logging enabled
   */
  debug?: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_HYBRID_CONFIG: Required<HybridStorageConfig> = {
  memory: {
    maxSize: 50 * 1024 * 1024, // 50MB
    ttl: 3600, // 1 hour
    enabled: true
  },
  pglite: {
    maxSize: 100 * 1024 * 1024, // 100MB
    ttl: 24 * 3600, // 24 hours
    enabled: true
  },
  github: {
    enabled: true,
    apiKey: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '',
    timeout: 30000 // 30 seconds
  },
  strategy: CacheStrategy.READ_THROUGH,
  circuitBreaker: {
    threshold: 5,
    timeout: 60000, // 1 minute
    successThreshold: 2
  },
  debug: false
};

/**
 * Statistics for monitoring hybrid storage performance
 */
export interface HybridStorageStats {
  /**
   * Cache hit statistics per tier
   */
  hits: {
    memory: number;
    pglite: number;
    github: number;
  };
  
  /**
   * Cache miss count
   */
  misses: number;
  
  /**
   * Response time statistics
   */
  responseTimes: {
    memory: number[];
    pglite: number[];
    github: number[];
  };
  
  /**
   * Circuit breaker status
   */
  circuitBreaker: {
    state: string;
    failureCount: number;
    isOpen: boolean;
  };
  
  /**
   * Total operations performed
   */
  totalOperations: number;
  
  /**
   * Current tier availability
   */
  tierAvailability: {
    memory: boolean;
    pglite: boolean;
    github: boolean;
  };
  
  /**
   * Request deduplication statistics
   */
  deduplication: {
    totalRequests: number;
    deduplicatedRequests: number;
    currentInFlight: number;
    deduplicationRate: number;
  };
}

/**
 * Create default statistics object
 */
export function createDefaultStats(): HybridStorageStats {
  return {
    hits: {
      memory: 0,
      pglite: 0,
      github: 0
    },
    misses: 0,
    responseTimes: {
      memory: [],
      pglite: [],
      github: []
    },
    circuitBreaker: {
      state: 'CLOSED',
      failureCount: 0,
      isOpen: false
    },
    totalOperations: 0,
    tierAvailability: {
      memory: true,
      pglite: true,
      github: true
    },
    deduplication: {
      totalRequests: 0,
      deduplicatedRequests: 0,
      currentInFlight: 0,
      deduplicationRate: 0
    }
  };
}

/**
 * Calculate cache hit rate from statistics
 */
export function calculateHitRate(stats: HybridStorageStats): number {
  const totalHits = stats.hits.memory + stats.hits.pglite + stats.hits.github;
  const totalRequests = totalHits + stats.misses;
  
  if (totalRequests === 0) {
    return 0;
  }
  
  return Math.round((totalHits / totalRequests) * 100 * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate average response time for a tier
 */
export function calculateAverageResponseTime(responseTimes: number[]): number {
  if (responseTimes.length === 0) {
    return 0;
  }
  
  const sum = responseTimes.reduce((acc, time) => acc + time, 0);
  return Math.round((sum / responseTimes.length) * 100) / 100; // Round to 2 decimal places
}