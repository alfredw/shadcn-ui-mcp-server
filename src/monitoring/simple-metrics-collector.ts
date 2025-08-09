/**
 * Simple metrics collector for performance monitoring
 */

import { HybridStorageStats } from '../storage/hybrid/cache-strategies.js';
import { ConfigurationManager } from '../config/manager.js';
import { getStorageStats, isStorageInitialized, getConfigurationManager } from '../utils/storage-integration.js';
import { logger } from '../utils/logger.js';

export interface PerformanceMetrics {
  timestamp: number;
  cacheMetrics: {
    hitRate: number;
    totalRequests: number;
    hits: number;
    misses: number;
    avgResponseTime: number;
  };
  storageMetrics: {
    memory: TierMetrics;
    pglite: TierMetrics;
    github: TierMetrics;
  };
  apiMetrics: {
    githubRequests: number;
    rateLimitRemaining: number;
    avgResponseTime: number;
    errors: number;
  };
  systemMetrics: {
    uptime: number;
    memoryUsage: number;
    storageSize: StorageSize;
  };
}

export interface TierMetrics {
  available: boolean;
  responseTime: number;
  errorRate: number;
  usage: number;
}

export interface StorageSize {
  memory: { used: number; max: number };
  pglite: { used: number; max: number };
}

export class SimpleMetricsCollector {
  private metrics: PerformanceMetrics[] = [];
  private currentMetrics: Partial<PerformanceMetrics>;
  private startTime = Date.now();
  private collectionInterval?: NodeJS.Timeout;
  private config: ConfigurationManager;
  
  constructor() {
    try {
      this.config = getConfigurationManager();
    } catch (error) {
      logger.error(`Failed to get configuration manager, using defaults: ${error}`);
      // Create a minimal mock config for graceful degradation
      this.config = {
        getAll: () => ({
          storage: {
            memory: { maxSize: 50 * 1024 * 1024 },
            pglite: { maxSize: 100 * 1024 * 1024 }
          }
        })
      } as any;
    }
    this.currentMetrics = this.initializeMetrics();
    this.startCollectionInterval();
  }
  
  private initializeMetrics(): Partial<PerformanceMetrics> {
    return {
      cacheMetrics: {
        hitRate: 0,
        totalRequests: 0,
        hits: 0,
        misses: 0,
        avgResponseTime: 0
      },
      apiMetrics: {
        githubRequests: 0,
        rateLimitRemaining: 5000,
        avgResponseTime: 0,
        errors: 0
      }
    };
  }
  
  recordCacheAccess(hit: boolean, responseTime: number): void {
    if (!this.currentMetrics.cacheMetrics) return;
    
    const cache = this.currentMetrics.cacheMetrics;
    
    cache.totalRequests++;
    if (hit) {
      cache.hits++;
    } else {
      cache.misses++;
    }
    
    // Update average response time
    cache.avgResponseTime = 
      (cache.avgResponseTime * (cache.totalRequests - 1) + responseTime) / 
      cache.totalRequests;
    
    // Update hit rate
    cache.hitRate = cache.totalRequests > 0 
      ? (cache.hits / cache.totalRequests) * 100 
      : 0;
  }
  
  recordApiCall(success: boolean, responseTime: number, rateLimitRemaining?: number): void {
    if (!this.currentMetrics.apiMetrics) return;
    
    const api = this.currentMetrics.apiMetrics;
    
    api.githubRequests++;
    
    if (!success) {
      api.errors++;
    }
    
    // Update average response time
    api.avgResponseTime = 
      (api.avgResponseTime * (api.githubRequests - 1) + responseTime) / 
      api.githubRequests;
    
    if (rateLimitRemaining !== undefined) {
      api.rateLimitRemaining = rateLimitRemaining;
    }
  }
  
  private async collectStorageMetrics(): Promise<void> {
    try {
      if (!isStorageInitialized()) {
        logger.warn('Storage not initialized, skipping metrics collection');
        return;
      }

      const hybridStats = getStorageStats();
      
      if (!hybridStats) {
        logger.warn('No storage stats available, skipping metrics collection');
        return;
      }
      
      const storageMetrics = {
        memory: await this.convertToTierMetrics('memory', hybridStats),
        pglite: await this.convertToTierMetrics('pglite', hybridStats),
        github: await this.convertToTierMetrics('github', hybridStats)
      };
      
      const systemMetrics = {
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage().heapUsed,
        storageSize: await this.getStorageSize(hybridStats)
      };
      
      // Update current metrics with hybrid stats data
      this.updateCurrentMetricsFromHybridStats(hybridStats);
      
      // Create complete metrics snapshot
      const snapshot: PerformanceMetrics = {
        timestamp: Date.now(),
        cacheMetrics: { ...this.currentMetrics.cacheMetrics! },
        storageMetrics,
        apiMetrics: { ...this.currentMetrics.apiMetrics! },
        systemMetrics
      };
      
      this.metrics.push(snapshot);
      
      // Keep only last hour of metrics
      const cutoff = Date.now() - 3600000;
      this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
      
    } catch (error) {
      logger.error('Failed to collect storage metrics:', error);
    }
  }
  
  private updateCurrentMetricsFromHybridStats(hybridStats: HybridStorageStats): void {
    if (!this.currentMetrics.cacheMetrics) return;
    
    const cache = this.currentMetrics.cacheMetrics;
    const totalHits = hybridStats.hits.memory + hybridStats.hits.pglite + hybridStats.hits.github;
    const totalRequests = totalHits + hybridStats.misses;
    
    // Update with actual hybrid storage stats
    cache.totalRequests = totalRequests;
    cache.hits = totalHits;
    cache.misses = hybridStats.misses;
    cache.hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
    
    // Calculate average response time from hybrid stats
    const allResponseTimes = [
      ...hybridStats.responseTimes.memory,
      ...hybridStats.responseTimes.pglite,
      ...hybridStats.responseTimes.github
    ];
    
    if (allResponseTimes.length > 0) {
      cache.avgResponseTime = allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length;
    }
  }
  
  private async convertToTierMetrics(tier: 'memory' | 'pglite' | 'github', hybridStats: HybridStorageStats): Promise<TierMetrics> {
    const available = hybridStats.tierAvailability[tier];
    const responseTimes = hybridStats.responseTimes[tier];
    
    // Calculate average response time for this tier
    const avgResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;
    
    // Error rate based on circuit breaker if GitHub tier
    const errorRate = tier === 'github' && hybridStats.circuitBreaker.isOpen ? 1 : 0;
    
    // Usage percentage (simplified - can be enhanced with actual size data)
    const usage = this.calculateTierUsage(tier);
    
    return {
      available,
      responseTime: avgResponseTime,
      errorRate,
      usage
    };
  }
  
  private calculateTierUsage(tier: 'memory' | 'pglite' | 'github'): number {
    try {
      const config = this.config.getAll();
      
      // For GitHub tier, usage is not applicable
      if (tier === 'github') return 0;
      
      // For memory/pglite, we would need actual size data
      // This is a simplified implementation
      return tier === 'memory' ? 50 : 30;
    } catch (error) {
      return 0;
    }
  }
  
  private async getStorageSize(hybridStats: HybridStorageStats): Promise<StorageSize> {
    try {
      const config = this.config.getAll();
      
      return {
        memory: {
          used: 0, // Would need actual memory usage data
          max: config.storage?.memory?.maxSize || 50 * 1024 * 1024
        },
        pglite: {
          used: 0, // Would need actual pglite database size
          max: config.storage?.pglite?.maxSize || 100 * 1024 * 1024
        }
      };
    } catch (error) {
      logger.error(`Failed to get storage size: ${error}`);
      return {
        memory: { used: 0, max: 50 * 1024 * 1024 },
        pglite: { used: 0, max: 100 * 1024 * 1024 }
      };
    }
  }
  
  private startCollectionInterval(): void {
    this.collectionInterval = setInterval(() => {
      this.collectStorageMetrics().catch(error => {
        logger.error('Failed to collect metrics:', error);
      });
    }, 60000); // Collect every minute
  }
  
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }
  
  getMetricsHistory(minutes: number = 60): PerformanceMetrics[] {
    const cutoff = Date.now() - (minutes * 60000);
    return this.metrics.filter(m => m.timestamp > cutoff);
  }
  
  exportMetrics(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2);
    }
    
    // CSV export
    const headers = [
      'timestamp',
      'cache_hit_rate',
      'total_requests',
      'avg_response_time',
      'github_requests',
      'rate_limit_remaining',
      'memory_usage_mb'
    ];
    
    const rows = this.metrics.map(m => [
      new Date(m.timestamp).toISOString(),
      m.cacheMetrics.hitRate.toFixed(2),
      m.cacheMetrics.totalRequests,
      m.cacheMetrics.avgResponseTime.toFixed(2),
      m.apiMetrics.githubRequests,
      m.apiMetrics.rateLimitRemaining,
      (m.systemMetrics.memoryUsage / 1024 / 1024).toFixed(2)
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
  
  dispose(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = undefined;
    }
  }
}