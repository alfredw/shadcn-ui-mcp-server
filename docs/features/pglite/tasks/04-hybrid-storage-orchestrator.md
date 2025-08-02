# Task 04: Hybrid Storage Orchestrator Implementation

## Overview
Create a hybrid storage orchestrator that coordinates between multiple storage providers (Memory, PGLite, GitHub) to provide optimal performance with fallback capabilities. This implements a multi-tier caching strategy with automatic promotion/demotion of data between tiers.

## Objectives
- Implement multi-tier storage orchestration
- Create intelligent data promotion/demotion logic
- Handle fallback scenarios gracefully
- Provide unified interface for all storage operations
- Implement circuit breaker for GitHub API

## Technical Requirements

### Hybrid Storage Architecture
```typescript
interface HybridStorageConfig {
  memory?: MemoryStorageConfig;
  pglite?: PGLiteStorageConfig;
  github?: GitHubStorageConfig;
  strategy?: CacheStrategy;
  circuitBreaker?: CircuitBreakerConfig;
}

enum CacheStrategy {
  WRITE_THROUGH = 'write-through',    // Write to all layers
  WRITE_BEHIND = 'write-behind',      // Write to L1, async to others
  READ_THROUGH = 'read-through',      // Read misses populate cache
  CACHE_ASIDE = 'cache-aside'         // Application manages cache
}

class HybridStorage implements StorageProvider {
  private providers: {
    memory?: MemoryStorageProvider;   // L1 Cache (fastest)
    pglite?: PGLiteStorageProvider;   // L2 Cache (persistent)
    github?: GitHubStorageProvider;   // L3 Source (source of truth)
  };
  
  private circuitBreaker: CircuitBreaker;
  private strategy: CacheStrategy;
  private statsCollector: StatsCollector;
  
  constructor(config: HybridStorageConfig) {
    this.initializeProviders(config);
    this.strategy = config.strategy || CacheStrategy.READ_THROUGH;
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
  }
  
  async get(key: string): Promise<any>;
  async set(key: string, value: any, ttl?: number): Promise<void>;
  // ... other StorageProvider methods
}
```

### Read Strategy Implementation
```typescript
async get(key: string): Promise<any> {
  const startTime = Date.now();
  
  try {
    // L1: Memory Cache (fastest)
    if (this.providers.memory) {
      const value = await this.providers.memory.get(key);
      if (value !== undefined) {
        this.statsCollector.recordHit('memory', Date.now() - startTime);
        return value;
      }
    }
    
    // L2: PGLite Cache (persistent)
    if (this.providers.pglite) {
      const value = await this.providers.pglite.get(key);
      if (value !== undefined) {
        this.statsCollector.recordHit('pglite', Date.now() - startTime);
        
        // Promote to L1
        if (this.providers.memory) {
          await this.providers.memory.set(key, value);
        }
        
        return value;
      }
    }
    
    // L3: GitHub API (source of truth)
    if (this.providers.github && this.circuitBreaker.allowsRequest()) {
      try {
        const value = await this.providers.github.get(key);
        this.statsCollector.recordHit('github', Date.now() - startTime);
        
        // Populate lower tiers
        await this.populateCaches(key, value);
        
        this.circuitBreaker.recordSuccess();
        return value;
      } catch (error) {
        this.circuitBreaker.recordFailure();
        throw error;
      }
    }
    
    // All sources failed
    this.statsCollector.recordMiss(Date.now() - startTime);
    return undefined;
    
  } catch (error) {
    this.logger.error(`Failed to get key ${key}:`, error);
    throw error;
  }
}
```

### Write Strategy Implementation
```typescript
async set(key: string, value: any, ttl?: number): Promise<void> {
  switch (this.strategy) {
    case CacheStrategy.WRITE_THROUGH:
      // Write to all layers synchronously
      await Promise.all([
        this.providers.memory?.set(key, value, ttl),
        this.providers.pglite?.set(key, value, ttl),
        this.providers.github?.set(key, value, ttl)
      ].filter(Boolean));
      break;
      
    case CacheStrategy.WRITE_BEHIND:
      // Write to L1 immediately, others async
      if (this.providers.memory) {
        await this.providers.memory.set(key, value, ttl);
      }
      
      // Queue writes to other layers
      this.queueWrite('pglite', key, value, ttl);
      this.queueWrite('github', key, value, ttl);
      break;
      
    case CacheStrategy.READ_THROUGH:
    case CacheStrategy.CACHE_ASIDE:
      // Only write to cache layers, not source
      await Promise.all([
        this.providers.memory?.set(key, value, ttl),
        this.providers.pglite?.set(key, value, ttl)
      ].filter(Boolean));
      break;
  }
}
```

### Circuit Breaker Implementation

The hybrid storage requires a specialized circuit breaker that extends the existing `CircuitBreaker` from `src/utils/circuit-breaker.ts` to provide more granular control for storage operations:

```typescript
import { CircuitBreaker, CircuitBreakerState } from '../utils/circuit-breaker';

/**
 * Storage-specific circuit breaker with granular control
 * Extends the base CircuitBreaker to add storage-specific behavior
 */
class StorageCircuitBreaker extends CircuitBreaker {
  private logger: Logger;
  
  constructor(config: CircuitBreakerConfig) {
    super({
      failureThreshold: config.threshold || 5,
      timeout: config.timeout || 60000,
      successThreshold: config.successThreshold || 2
    });
    
    this.logger = new Logger('StorageCircuitBreaker');
  }
  
  /**
   * Check if a request should be allowed without executing it
   * This enables checking state before making storage decisions
   */
  allowsRequest(): boolean {
    const state = this.getState();
    
    if (state === CircuitBreakerState.CLOSED) {
      return true;
    }
    
    if (state === CircuitBreakerState.OPEN) {
      // Check if enough time has passed to attempt recovery
      if (this.shouldTransitionToHalfOpen()) {
        // Let the base class handle the transition on next execute
        return true;
      }
      return false;
    }
    
    // HALF_OPEN: allow request to test recovery
    return true;
  }
  
  /**
   * Manually record a successful operation
   * Used when we need to record success outside of execute()
   */
  async recordSuccess(): Promise<void> {
    // Use execute with a no-op to trigger success handling
    await this.execute(async () => {});
  }
  
  /**
   * Manually record a failed operation
   * Used when we need to record failure outside of execute()
   */
  async recordFailure(): Promise<void> {
    try {
      await this.execute(async () => {
        throw new Error('Manual failure recording');
      });
    } catch {
      // Expected - we're intentionally triggering failure
    }
  }
  
  /**
   * Check if circuit should attempt to transition to half-open
   */
  private shouldTransitionToHalfOpen(): boolean {
    // Access private members through reflection or add getter in base class
    const lastFailureTime = (this as any).lastFailureTime;
    const timeout = (this as any).config.timeout;
    
    return Date.now() - lastFailureTime >= timeout;
  }
  
  /**
   * Get detailed circuit breaker status for monitoring
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.getState(),
      failureCount: this.getFailureCount(),
      isRequestAllowed: this.allowsRequest(),
      lastFailureTime: (this as any).lastFailureTime
    };
  }
}

/**
 * Usage in Hybrid Storage:
 * This approach provides the best of both worlds:
 * 1. Reuses proven circuit breaker logic from base class
 * 2. Adds storage-specific methods for granular control
 * 3. Enables graceful degradation and fallback strategies
 */
class HybridStorage {
  private circuitBreaker: StorageCircuitBreaker;
  
  async get(key: string): Promise<any> {
    // ... L1 and L2 checks ...
    
    // L3: GitHub API with circuit breaker
    if (this.providers.github && this.circuitBreaker.allowsRequest()) {
      try {
        const value = await this.providers.github.get(key);
        await this.circuitBreaker.recordSuccess();
        
        // Populate lower tiers
        await this.populateCaches(key, value);
        
        return value;
      } catch (error) {
        await this.circuitBreaker.recordFailure();
        
        // Graceful degradation: try to serve stale data
        if (this.providers.pglite) {
          const staleData = await this.providers.pglite.get(key);
          if (staleData) {
            this.logger.warn(`Serving stale data for ${key} due to GitHub API failure`);
            return { ...staleData, _stale: true };
          }
        }
        
        throw error;
      }
    }
    
    // Circuit is open - attempt to serve from cache
    if (!this.circuitBreaker.allowsRequest()) {
      this.statsCollector.recordCircuitBreakerOpen();
      
      const cachedValue = await this.providers.pglite?.get(key);
      if (cachedValue) {
        return { ...cachedValue, _fallback: true };
      }
    }
    
    return undefined;
  }
}
```

### Batch Operations Optimization
```typescript
async mget(keys: string[]): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  const missingFromL1: string[] = [];
  const missingFromL2: string[] = [];
  
  // Try L1 first
  if (this.providers.memory) {
    const l1Results = await this.providers.memory.mget(keys);
    l1Results.forEach((value, key) => {
      if (value !== undefined) {
        results.set(key, value);
      } else {
        missingFromL1.push(key);
      }
    });
  }
  
  // Try L2 for L1 misses
  if (this.providers.pglite && missingFromL1.length > 0) {
    const l2Results = await this.providers.pglite.mget(missingFromL1);
    l2Results.forEach((value, key) => {
      if (value !== undefined) {
        results.set(key, value);
        // Promote to L1
        this.providers.memory?.set(key, value);
      } else {
        missingFromL2.push(key);
      }
    });
  }
  
  // Try L3 for remaining misses
  if (this.providers.github && missingFromL2.length > 0) {
    // Batch fetch from GitHub...
  }
  
  return results;
}
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/storage/
   ├── hybrid/
   │   ├── hybrid-storage.ts
   │   ├── storage-circuit-breaker.ts  // Extends base CircuitBreaker
   │   ├── cache-strategies.ts
   │   └── write-queue.ts
   └── providers/
       └── github-storage-provider.ts
   ```

2. **Stats Collection**:
   - Cache hit/miss rates per tier
   - Response time metrics
   - Circuit breaker state changes
   - Queue depths for write-behind

3. **Error Handling**:
   - Graceful degradation
   - Fallback to available providers
   - Error propagation strategies

### Acceptance Criteria
- [ ] Hybrid storage orchestrates all three tiers correctly
- [ ] Read-through caching works with automatic promotion
- [ ] Write strategies implemented and configurable
- [ ] Circuit breaker protects against GitHub API failures
- [ ] Batch operations optimized across tiers
- [ ] Statistics collection works
- [ ] Graceful fallback when providers unavailable

### Testing Requirements
- Unit tests for each cache strategy
- Integration tests with all providers
- Circuit breaker state transition tests
- Performance tests comparing strategies
- Failure scenario tests
- Concurrent operation tests

### Dependencies
- Task 01: Storage Provider Interface
- Task 02: PGLite Database Initialization
- Task 03: PGLite Storage Provider
- Existing circuit breaker implementation (`src/utils/circuit-breaker.ts`)

### Estimated Effort
- 3-4 days

### Example Usage
```typescript
const hybrid = new HybridStorage({
  memory: {
    maxSize: 50 * 1024 * 1024, // 50MB
    ttl: 3600 // 1 hour
  },
  pglite: {
    dbManager: await createDBManager(),
    maxSize: 100 * 1024 * 1024 // 100MB
  },
  github: {
    token: process.env.GITHUB_TOKEN,
    baseUrl: 'https://api.github.com'
  },
  strategy: CacheStrategy.READ_THROUGH,
  circuitBreaker: {
    threshold: 5,
    timeout: 60000 // 1 minute
  }
});

// Single item fetch (tries L1 → L2 → L3)
const component = await hybrid.get('component:react:button');

// Batch fetch (optimized across tiers)
const components = await hybrid.mget([
  'component:react:button',
  'component:react:card',
  'component:react:dialog'
]);

// Get statistics
const stats = hybrid.getStats();
console.log(`Cache hit rate: ${stats.hitRate}%`);
```

### Notes
- Consider implementing cache warming strategies
- Add support for cache invalidation patterns
- Plan for monitoring and alerting integration
- Document performance tuning guidelines