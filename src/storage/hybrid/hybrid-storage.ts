import { StorageMetadata, StorageProvider, StorageProviderConfig } from '../interfaces/storage-provider.js';
import { BaseStorageProvider } from '../providers/base-storage-provider.js';
import { MemoryStorageProvider } from '../providers/memory-storage-provider.js';
import { PGLiteStorageProvider } from '../providers/pglite-storage-provider.js';
import { GitHubStorageProvider } from '../providers/github-storage-provider.js';
import { StorageCircuitBreaker } from './storage-circuit-breaker.js';
import { 
  CacheStrategy, 
  HybridStorageConfig, 
  HybridStorageStats, 
  DEFAULT_HYBRID_CONFIG,
  createDefaultStats,
  calculateHitRate,
  calculateAverageResponseTime
} from './cache-strategies.js';

/**
 * Storage provider configuration for each tier
 */
interface TierProviders {
  memory?: MemoryStorageProvider;   // L1 Cache (fastest)
  pglite?: PGLiteStorageProvider;   // L2 Cache (persistent)
  github?: GitHubStorageProvider;   // L3 Source (source of truth)
}

/**
 * Hybrid storage orchestrator that coordinates between multiple storage tiers
 * Implements intelligent caching strategies with automatic promotion/demotion
 */
export class HybridStorageProvider extends BaseStorageProvider {
  private providers: TierProviders = {};
  private circuitBreaker: StorageCircuitBreaker;
  private strategy: CacheStrategy;
  private hybridConfig: Required<HybridStorageConfig>;
  private stats: HybridStorageStats;
  private writeQueue: Array<{ key: string; value: any; ttl?: number; timestamp: number }> = [];
  private isProcessingQueue: boolean = false;
  
  constructor(config: HybridStorageConfig = {}) {
    // Merge with default configuration
    const mergedConfig = {
      ...DEFAULT_HYBRID_CONFIG,
      ...config,
      memory: { ...DEFAULT_HYBRID_CONFIG.memory, ...config.memory },
      pglite: { ...DEFAULT_HYBRID_CONFIG.pglite, ...config.pglite },
      github: { ...DEFAULT_HYBRID_CONFIG.github, ...config.github },
      circuitBreaker: { ...DEFAULT_HYBRID_CONFIG.circuitBreaker, ...config.circuitBreaker }
    };
    
    super({
      maxSize: Math.max(
        mergedConfig.memory.maxSize || 0,
        mergedConfig.pglite.maxSize || 0
      ),
      defaultTTL: mergedConfig.memory.ttl || 3600,
      debug: mergedConfig.debug
    });
    
    this.hybridConfig = mergedConfig;
    this.strategy = mergedConfig.strategy;
    this.stats = createDefaultStats();
    
    // Set initial tier availability based on configuration
    this.stats.tierAvailability.memory = false;
    this.stats.tierAvailability.pglite = false;
    this.stats.tierAvailability.github = false;
    
    // Initialize circuit breaker
    this.circuitBreaker = new StorageCircuitBreaker(mergedConfig.circuitBreaker);
    
    // Initialize providers based on configuration
    this.initializeProviders();
  }
  
  /**
   * Initialize storage providers based on configuration
   */
  private initializeProviders(): void {
    // Initialize L1 Memory Cache
    if (this.hybridConfig.memory.enabled) {
      try {
        this.providers.memory = new MemoryStorageProvider({
          maxSize: this.hybridConfig.memory.maxSize,
          defaultTTL: this.hybridConfig.memory.ttl,
          debug: this.hybridConfig.debug
        });
        this.stats.tierAvailability.memory = true;
        this.debug('Initialized L1 Memory provider');
      } catch (error) {
        this.stats.tierAvailability.memory = false;
        this.debug(`Failed to initialize L1 Memory provider: ${error}`);
      }
    }
    
    // Initialize L2 PGLite Cache
    if (this.hybridConfig.pglite.enabled) {
      try {
        this.providers.pglite = new PGLiteStorageProvider();
        this.stats.tierAvailability.pglite = true;
        this.debug('Initialized L2 PGLite provider');
      } catch (error) {
        this.stats.tierAvailability.pglite = false;
        this.debug(`Failed to initialize L2 PGLite provider: ${error}`);
      }
    }
    
    // Initialize L3 GitHub Source
    if (this.hybridConfig.github.enabled) {
      try {
        this.providers.github = new GitHubStorageProvider({
          apiKey: this.hybridConfig.github.apiKey,
          timeout: this.hybridConfig.github.timeout,
          debug: this.hybridConfig.debug
        });
        this.stats.tierAvailability.github = true;
        this.debug('Initialized L3 GitHub provider');
      } catch (error) {
        this.stats.tierAvailability.github = false;
        this.debug(`Failed to initialize L3 GitHub provider: ${error}`);
      }
    }
  }
  
  /**
   * Record a cache hit for statistics
   */
  private recordHit(tier: 'memory' | 'pglite' | 'github', responseTime: number): void {
    this.stats.hits[tier]++;
    this.stats.totalOperations++;
    this.stats.responseTimes[tier].push(responseTime);
    
    // Keep response time arrays manageable (last 100 requests)
    if (this.stats.responseTimes[tier].length > 100) {
      this.stats.responseTimes[tier] = this.stats.responseTimes[tier].slice(-100);
    }
  }
  
  /**
   * Record a cache miss for statistics
   */
  private recordMiss(): void {
    this.stats.misses++;
    this.stats.totalOperations++;
  }
  
  /**
   * Update circuit breaker statistics
   */
  private updateCircuitBreakerStats(): void {
    const status = this.circuitBreaker.getStatus();
    this.stats.circuitBreaker = {
      state: status.state,
      failureCount: status.failureCount,
      isOpen: !status.isRequestAllowed
    };
  }
  
  /**
   * Promote a value to higher-level caches
   */
  private async promoteToHigherTiers(key: string, value: any, currentTier: 'pglite' | 'github'): Promise<void> {
    try {
      if (currentTier === 'github') {
        // Promote from L3 to L2 and L1
        if (this.providers.pglite) {
          await this.providers.pglite.set(key, value);
        }
        if (this.providers.memory) {
          await this.providers.memory.set(key, value);
        }
      } else if (currentTier === 'pglite') {
        // Promote from L2 to L1
        if (this.providers.memory) {
          await this.providers.memory.set(key, value);
        }
      }
    } catch (error) {
      this.debug(`Failed to promote ${key} to higher tiers: ${error}`);
    }
  }
  
  /**
   * Multi-tier read strategy with automatic promotion
   */
  async get(key: string): Promise<any> {
    return this.wrapOperation(`get(${key})`, async () => {
      this.validateKey(key);
      const startTime = Date.now();
      
      try {
        // L1: Memory Cache (fastest)
        if (this.providers.memory && this.stats.tierAvailability.memory) {
          try {
            const value = await this.providers.memory.get(key);
            if (value !== undefined) {
              this.recordHit('memory', Date.now() - startTime);
              this.debug(`L1 cache hit: ${key}`);
              return value;
            }
          } catch (error) {
            this.stats.tierAvailability.memory = false;
            this.debug(`L1 cache error for ${key}: ${error}`);
          }
        }
        
        // L2: PGLite Cache (persistent)
        if (this.providers.pglite && this.stats.tierAvailability.pglite) {
          try {
            const value = await this.providers.pglite.get(key);
            if (value !== undefined) {
              this.recordHit('pglite', Date.now() - startTime);
              this.debug(`L2 cache hit: ${key}`);
              
              // Promote to L1
              await this.promoteToHigherTiers(key, value, 'pglite');
              
              return value;
            }
          } catch (error) {
            this.stats.tierAvailability.pglite = false;
            this.debug(`L2 cache error for ${key}: ${error}`);
          }
        }
        
        // L3: GitHub API (source of truth)
        if (this.providers.github && this.stats.tierAvailability.github && this.circuitBreaker.allowsRequest()) {
          try {
            const value = await this.circuitBreaker.executeWithFallback(
              async () => await this.providers.github!.get(key),
              async () => {
                // Fallback: try to serve stale data from L2
                if (this.providers.pglite) {
                  const staleData = await this.providers.pglite.get(key);
                  if (staleData) {
                    this.debug(`Serving stale data for ${key} due to GitHub API failure`);
                    return { ...staleData, _stale: true };
                  }
                }
                return undefined;
              }
            );
            
            if (value !== undefined && !value._stale) {
              this.recordHit('github', Date.now() - startTime);
              this.debug(`L3 source hit: ${key}`);
              
              // Populate lower tiers
              await this.promoteToHigherTiers(key, value, 'github');
              
              return value;
            } else if (value?._stale) {
              this.debug(`Served stale data for ${key}`);
              return value;
            }
          } catch (error) {
            this.stats.tierAvailability.github = false;
            this.debug(`L3 source error for ${key}: ${error}`);
          } finally {
            this.updateCircuitBreakerStats();
          }
        }
        
        // All sources failed or circuit breaker is open
        if (!this.circuitBreaker.allowsRequest()) {
          this.debug(`Circuit breaker open, attempting stale data for ${key}`);
          
          // Try to serve from cache when circuit is open
          if (this.providers.pglite) {
            const cachedValue = await this.providers.pglite.get(key);
            if (cachedValue) {
              this.debug(`Served fallback data for ${key}`);
              return { ...cachedValue, _fallback: true };
            }
          }
        }
        
        this.recordMiss();
        this.debug(`All tiers missed: ${key}`);
        return undefined;
        
      } catch (error) {
        this.debug(`Error in hybrid get(${key}): ${error}`);
        this.recordMiss();
        throw error;
      }
    });
  }
  
  /**
   * Multi-tier write strategy based on configuration
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.wrapOperation(`set(${key})`, async () => {
      this.validateKey(key);
      
      switch (this.strategy) {
        case CacheStrategy.WRITE_THROUGH:
          await this.writeThrough(key, value, ttl);
          break;
          
        case CacheStrategy.WRITE_BEHIND:
          await this.writeBehind(key, value, ttl);
          break;
          
        case CacheStrategy.READ_THROUGH:
        case CacheStrategy.CACHE_ASIDE:
          await this.writeCacheOnly(key, value, ttl);
          break;
          
        default:
          throw new Error(`Unknown cache strategy: ${this.strategy}`);
      }
    });
  }
  
  /**
   * Write-through strategy: write to all layers synchronously
   */
  private async writeThrough(key: string, value: any, ttl?: number): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.providers.memory && this.stats.tierAvailability.memory) {
      promises.push(this.providers.memory.set(key, value, ttl));
    }
    
    if (this.providers.pglite && this.stats.tierAvailability.pglite) {
      promises.push(this.providers.pglite.set(key, value, ttl));
    }
    
    if (this.providers.github && this.stats.tierAvailability.github) {
      promises.push(this.providers.github.set(key, value, ttl));
    }
    
    const results = await Promise.allSettled(promises);
    
    // Check for failures and update tier availability
    let hasFailure = false;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        hasFailure = true;
        const tier = index === 0 ? 'memory' : index === 1 ? 'pglite' : 'github';
        this.stats.tierAvailability[tier] = false;
        this.debug(`Write failed for ${tier}: ${result.reason}`);
      }
    });
    
    if (hasFailure) {
      this.debug(`Some write-through operations failed for ${key}`);
    } else {
      this.debug(`Write-through completed for ${key}`);
    }
  }
  
  /**
   * Write-behind strategy: write to L1 immediately, others async
   */
  private async writeBehind(key: string, value: any, ttl?: number): Promise<void> {
    // Write to L1 immediately
    if (this.providers.memory && this.stats.tierAvailability.memory) {
      try {
        await this.providers.memory.set(key, value, ttl);
        this.debug(`Write-behind L1 completed for ${key}`);
      } catch (error) {
        this.stats.tierAvailability.memory = false;
        this.debug(`Write-behind L1 failed for ${key}: ${error}`);
      }
    }
    
    // Queue writes to other layers
    this.writeQueue.push({
      key,
      value,
      ttl,
      timestamp: Date.now()
    });
    
    // Process queue asynchronously
    this.processWriteQueue();
  }
  
  /**
   * Cache-only strategy: only write to cache layers
   */
  private async writeCacheOnly(key: string, value: any, ttl?: number): Promise<void> {
    const promises: Promise<void>[] = [];
    
    if (this.providers.memory && this.stats.tierAvailability.memory) {
      promises.push(this.providers.memory.set(key, value, ttl));
    }
    
    if (this.providers.pglite && this.stats.tierAvailability.pglite) {
      promises.push(this.providers.pglite.set(key, value, ttl));
    }
    
    await Promise.allSettled(promises);
    this.debug(`Cache-only write completed for ${key}`);
  }
  
  /**
   * Process the write queue for write-behind strategy
   */
  private async processWriteQueue(): Promise<void> {
    if (this.isProcessingQueue || this.writeQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      while (this.writeQueue.length > 0) {
        const batch = this.writeQueue.splice(0, 10); // Process in batches of 10
        
        const promises = batch.map(async (item) => {
          try {
            // Write to L2
            if (this.providers.pglite && this.stats.tierAvailability.pglite) {
              await this.providers.pglite.set(item.key, item.value, item.ttl);
            }
            
            // Write to L3 (GitHub cache only)
            if (this.providers.github && this.stats.tierAvailability.github) {
              await this.providers.github.set(item.key, item.value, item.ttl);
            }
          } catch (error) {
            this.debug(`Write queue processing failed for ${item.key}: ${error}`);
          }
        });
        
        await Promise.allSettled(promises);
        
        // Small delay between batches
        if (this.writeQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }
  
  async has(key: string): Promise<boolean> {
    return this.wrapOperation(`has(${key})`, async () => {
      this.validateKey(key);
      
      // Check tiers in order
      if (this.providers.memory && await this.providers.memory.has(key)) {
        return true;
      }
      
      if (this.providers.pglite && await this.providers.pglite.has(key)) {
        return true;
      }
      
      if (this.providers.github && this.circuitBreaker.allowsRequest()) {
        try {
          return await this.providers.github.has(key);
        } catch {
          return false;
        }
      }
      
      return false;
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.wrapOperation(`delete(${key})`, async () => {
      this.validateKey(key);
      
      let deleted = false;
      
      // Delete from all tiers
      if (this.providers.memory) {
        deleted = await this.providers.memory.delete(key) || deleted;
      }
      
      if (this.providers.pglite) {
        deleted = await this.providers.pglite.delete(key) || deleted;
      }
      
      if (this.providers.github) {
        deleted = await this.providers.github.delete(key) || deleted;
      }
      
      return deleted;
    });
  }
  
  async clear(): Promise<void> {
    return this.wrapOperation('clear()', async () => {
      const promises: Promise<void>[] = [];
      
      if (this.providers.memory) {
        promises.push(this.providers.memory.clear());
      }
      
      if (this.providers.pglite) {
        promises.push(this.providers.pglite.clear());
      }
      
      if (this.providers.github) {
        promises.push(this.providers.github.clear());
      }
      
      await Promise.allSettled(promises);
      
      // Clear statistics
      this.stats = createDefaultStats();
      this.debug('Cleared all hybrid storage tiers');
    });
  }
  
  async mget(keys: string[]): Promise<Map<string, any>> {
    return this.wrapOperation(`mget([${keys.length} keys])`, async () => {
      const result = new Map<string, any>();
      const missingFromL1: string[] = [];
      const missingFromL2: string[] = [];
      
      // Try L1 first (batch)
      if (this.providers.memory && this.stats.tierAvailability.memory) {
        try {
          const l1Results = await this.providers.memory.mget(keys);
          l1Results.forEach((value, key) => {
            if (value !== undefined) {
              result.set(key, value);
            } else {
              missingFromL1.push(key);
            }
          });
        } catch (error) {
          this.stats.tierAvailability.memory = false;
          missingFromL1.push(...keys);
        }
      } else {
        missingFromL1.push(...keys);
      }
      
      // Try L2 for L1 misses
      if (this.providers.pglite && this.stats.tierAvailability.pglite && missingFromL1.length > 0) {
        try {
          const l2Results = await this.providers.pglite.mget(missingFromL1);
          l2Results.forEach((value, key) => {
            if (value !== undefined) {
              result.set(key, value);
              // Promote to L1
              if (this.providers.memory) {
                this.providers.memory.set(key, value).catch(err => 
                  this.debug(`Failed to promote ${key} to L1: ${err}`)
                );
              }
            } else {
              missingFromL2.push(key);
            }
          });
        } catch (error) {
          this.stats.tierAvailability.pglite = false;
          missingFromL2.push(...missingFromL1);
        }
      } else {
        missingFromL2.push(...missingFromL1);
      }
      
      // Try L3 for remaining misses
      if (this.providers.github && this.stats.tierAvailability.github && 
          this.circuitBreaker.allowsRequest() && missingFromL2.length > 0) {
        try {
          const l3Results = await this.providers.github.mget(missingFromL2);
          l3Results.forEach((value, key) => {
            if (value !== undefined) {
              result.set(key, value);
              // Populate lower tiers
              this.promoteToHigherTiers(key, value, 'github').catch(err =>
                this.debug(`Failed to populate lower tiers for ${key}: ${err}`)
              );
            }
          });
        } catch (error) {
          this.stats.tierAvailability.github = false;
        }
      }
      
      return result;
    });
  }
  
  async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
    return this.wrapOperation(`mset([${entries.size} entries])`, async () => {
      switch (this.strategy) {
        case CacheStrategy.WRITE_THROUGH:
          const promises: Promise<void>[] = [];
          
          if (this.providers.memory && this.stats.tierAvailability.memory) {
            promises.push(this.providers.memory.mset(entries, ttl));
          }
          
          if (this.providers.pglite && this.stats.tierAvailability.pglite) {
            promises.push(this.providers.pglite.mset(entries, ttl));
          }
          
          if (this.providers.github && this.stats.tierAvailability.github) {
            promises.push(this.providers.github.mset(entries, ttl));
          }
          
          await Promise.allSettled(promises);
          break;
          
        case CacheStrategy.WRITE_BEHIND:
          // Write to L1 immediately
          if (this.providers.memory && this.stats.tierAvailability.memory) {
            await this.providers.memory.mset(entries, ttl);
          }
          
          // Queue individual writes
          for (const [key, value] of entries) {
            this.writeQueue.push({ key, value, ttl, timestamp: Date.now() });
          }
          this.processWriteQueue();
          break;
          
        default:
          // Cache-only strategies
          const cachePromises: Promise<void>[] = [];
          
          if (this.providers.memory && this.stats.tierAvailability.memory) {
            cachePromises.push(this.providers.memory.mset(entries, ttl));
          }
          
          if (this.providers.pglite && this.stats.tierAvailability.pglite) {
            cachePromises.push(this.providers.pglite.mset(entries, ttl));
          }
          
          await Promise.allSettled(cachePromises);
          break;
      }
    });
  }
  
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    return this.wrapOperation(`getMetadata(${key})`, async () => {
      this.validateKey(key);
      
      // Try to get metadata from the first available tier
      if (this.providers.memory) {
        const metadata = await this.providers.memory.getMetadata(key);
        if (metadata) return metadata;
      }
      
      if (this.providers.pglite) {
        const metadata = await this.providers.pglite.getMetadata(key);
        if (metadata) return metadata;
      }
      
      if (this.providers.github) {
        const metadata = await this.providers.github.getMetadata(key);
        if (metadata) return metadata;
      }
      
      return null;
    });
  }
  
  async keys(pattern?: string): Promise<string[]> {
    return this.wrapOperation(`keys(${pattern ?? '*'})`, async () => {
      const allKeys = new Set<string>();
      
      // Collect keys from all tiers
      if (this.providers.memory) {
        const memoryKeys = await this.providers.memory.keys(pattern);
        memoryKeys.forEach(key => allKeys.add(key));
      }
      
      if (this.providers.pglite) {
        const pgliteKeys = await this.providers.pglite.keys(pattern);
        pgliteKeys.forEach(key => allKeys.add(key));
      }
      
      if (this.providers.github) {
        const githubKeys = await this.providers.github.keys(pattern);
        githubKeys.forEach(key => allKeys.add(key));
      }
      
      return Array.from(allKeys);
    });
  }
  
  async size(): Promise<number> {
    return this.wrapOperation('size()', async () => {
      // Return size from the most comprehensive tier (PGLite if available, otherwise memory)
      if (this.providers.pglite) {
        return await this.providers.pglite.size();
      }
      
      if (this.providers.memory) {
        return await this.providers.memory.size();
      }
      
      if (this.providers.github) {
        return await this.providers.github.size();
      }
      
      return 0;
    });
  }
  
  /**
   * Dispose of all resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    
    // Wait for write queue to finish
    let retries = 0;
    while (this.isProcessingQueue && retries < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }
    
    // Dispose of all providers
    const promises: Promise<void>[] = [];
    
    if (this.providers.memory) {
      promises.push(this.providers.memory.dispose());
    }
    
    if (this.providers.pglite) {
      promises.push(this.providers.pglite.dispose());
    }
    
    if (this.providers.github) {
      promises.push(this.providers.github.dispose());
    }
    
    await Promise.allSettled(promises);
    
    this.providers = {};
    this.writeQueue = [];
    
    await super.dispose();
    this.debug('Hybrid storage disposed');
  }
  
  /**
   * Get comprehensive statistics about hybrid storage performance
   */
  getStats(): HybridStorageStats & { hitRate: number; avgResponseTimes: Record<string, number> } {
    this.updateCircuitBreakerStats();
    
    return {
      ...this.stats,
      hitRate: calculateHitRate(this.stats),
      avgResponseTimes: {
        memory: calculateAverageResponseTime(this.stats.responseTimes.memory),
        pglite: calculateAverageResponseTime(this.stats.responseTimes.pglite),
        github: calculateAverageResponseTime(this.stats.responseTimes.github)
      }
    };
  }
  
  /**
   * Get current configuration
   */
  getHybridConfig(): Required<HybridStorageConfig> {
    return { ...this.hybridConfig };
  }
  
  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }
  
  /**
   * Manually control circuit breaker
   */
  openCircuitBreaker(): void {
    this.circuitBreaker.open();
    this.updateCircuitBreakerStats();
  }
  
  closeCircuitBreaker(): void {
    this.circuitBreaker.close();
    this.updateCircuitBreakerStats();
  }
}