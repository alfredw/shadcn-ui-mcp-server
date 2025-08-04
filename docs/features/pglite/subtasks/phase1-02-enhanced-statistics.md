# Phase 1, Task 2: Enhanced Statistics Collection

## Overview
Enhance the existing statistics collection to provide deeper insights into cache performance, GitHub API usage patterns, and framework-specific metrics. This will help monitor the effectiveness of the caching system and identify optimization opportunities.

## Objectives
- Track detailed GitHub API usage vs cache hit rates
- Monitor response times for each storage tier
- Collect framework-specific performance metrics
- Track cache eviction patterns and efficiency
- Provide actionable insights for optimization

## Technical Requirements

### Enhanced Statistics Schema
```typescript
export interface EnhancedCacheStatistics {
  // Overall metrics
  overall: {
    totalRequests: number;
    cacheHitRate: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  
  // Tier-specific metrics
  tiers: {
    memory: TierStatistics;
    pglite: TierStatistics;
    github: TierStatistics;
  };
  
  // Framework-specific metrics
  frameworks: {
    react: FrameworkStatistics;
    svelte: FrameworkStatistics;
  };
  
  // Resource type metrics
  resourceTypes: {
    components: ResourceTypeStatistics;
    blocks: ResourceTypeStatistics;
    demos: ResourceTypeStatistics;
    metadata: ResourceTypeStatistics;
    lists: ResourceTypeStatistics;
  };
  
  // GitHub API metrics
  githubApi: {
    requestCount: number;
    rateLimitRemaining: number;
    rateLimitReset: Date;
    avgResponseTime: number;
    errorCount: number;
    circuitBreakerState: 'closed' | 'open' | 'half-open';
  };
  
  // Cache efficiency
  cacheEfficiency: {
    evictionCount: number;
    avgTimeToEviction: number;
    hotKeys: Array<{ key: string; accessCount: number }>;
    coldKeys: Array<{ key: string; lastAccess: Date }>;
    memorySavedBytes: number;
    apiCallsSaved: number;
  };
}

interface TierStatistics {
  hits: number;
  misses: number;
  errors: number;
  avgResponseTime: number;
  bytesServed: number;
}

interface FrameworkStatistics {
  requestCount: number;
  uniqueComponents: number;
  cacheHitRate: number;
  popularComponents: Array<{ name: string; accessCount: number }>;
}

interface ResourceTypeStatistics {
  requestCount: number;
  cacheHitRate: number;
  avgSize: number;
  totalSize: number;
}
```

### Statistics Collector Enhancement
```typescript
export class EnhancedStatisticsCollector {
  private metrics: EnhancedCacheStatistics;
  private responseTimes: Map<string, number[]> = new Map();
  private accessPatterns: Map<string, AccessPattern> = new Map();
  
  constructor() {
    this.initializeMetrics();
    this.startPeriodicAggregation();
  }
  
  recordCacheAccess(event: CacheAccessEvent): void {
    const { tier, hit, responseTime, framework, resourceType, key, bytesServed } = event;
    
    // Update overall metrics
    this.metrics.overall.totalRequests++;
    this.addResponseTime('overall', responseTime);
    
    // Update tier metrics
    const tierStats = this.metrics.tiers[tier];
    if (hit) {
      tierStats.hits++;
    } else {
      tierStats.misses++;
    }
    tierStats.bytesServed += bytesServed || 0;
    this.addResponseTime(tier, responseTime);
    
    // Update framework metrics
    if (framework) {
      const frameworkStats = this.metrics.frameworks[framework];
      frameworkStats.requestCount++;
      this.trackComponentAccess(framework, key);
    }
    
    // Update resource type metrics
    if (resourceType) {
      const resourceStats = this.metrics.resourceTypes[resourceType];
      resourceStats.requestCount++;
      resourceStats.totalSize += bytesServed || 0;
    }
    
    // Track access patterns
    this.updateAccessPattern(key, tier, hit);
  }
  
  recordGitHubApiCall(event: GitHubApiEvent): void {
    const { responseTime, error, rateLimitRemaining, rateLimitReset } = event;
    
    this.metrics.githubApi.requestCount++;
    
    if (error) {
      this.metrics.githubApi.errorCount++;
    } else {
      this.addResponseTime('github-api', responseTime);
      
      if (rateLimitRemaining !== undefined) {
        this.metrics.githubApi.rateLimitRemaining = rateLimitRemaining;
        this.metrics.githubApi.rateLimitReset = new Date(rateLimitReset * 1000);
      }
    }
  }
  
  recordEviction(event: EvictionEvent): void {
    const { key, age, size } = event;
    
    this.metrics.cacheEfficiency.evictionCount++;
    this.metrics.cacheEfficiency.avgTimeToEviction = 
      (this.metrics.cacheEfficiency.avgTimeToEviction * (this.metrics.cacheEfficiency.evictionCount - 1) + age) / 
      this.metrics.cacheEfficiency.evictionCount;
  }
  
  private addResponseTime(category: string, time: number): void {
    if (!this.responseTimes.has(category)) {
      this.responseTimes.set(category, []);
    }
    
    const times = this.responseTimes.get(category)!;
    times.push(time);
    
    // Keep only last 1000 samples per category
    if (times.length > 1000) {
      times.shift();
    }
  }
  
  private calculatePercentile(times: number[], percentile: number): number {
    if (times.length === 0) return 0;
    
    const sorted = [...times].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }
  
  getStatistics(): EnhancedCacheStatistics {
    // Calculate response time percentiles
    const overallTimes = this.responseTimes.get('overall') || [];
    this.metrics.overall.avgResponseTime = this.average(overallTimes);
    this.metrics.overall.p95ResponseTime = this.calculatePercentile(overallTimes, 95);
    this.metrics.overall.p99ResponseTime = this.calculatePercentile(overallTimes, 99);
    
    // Calculate cache hit rate
    const totalHits = Object.values(this.metrics.tiers)
      .reduce((sum, tier) => sum + tier.hits, 0);
    const totalRequests = this.metrics.overall.totalRequests;
    this.metrics.overall.cacheHitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
    
    // Calculate hot/cold keys
    this.calculateAccessPatterns();
    
    // Calculate cache efficiency
    this.calculateCacheEfficiency();
    
    return this.metrics;
  }
  
  private calculateAccessPatterns(): void {
    const patterns = Array.from(this.accessPatterns.entries())
      .map(([key, pattern]) => ({ key, ...pattern }));
    
    // Hot keys - top 10 by access count
    this.metrics.cacheEfficiency.hotKeys = patterns
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 10)
      .map(p => ({ key: p.key, accessCount: p.accessCount }));
    
    // Cold keys - bottom 10 by last access
    this.metrics.cacheEfficiency.coldKeys = patterns
      .filter(p => p.lastAccess)
      .sort((a, b) => a.lastAccess!.getTime() - b.lastAccess!.getTime())
      .slice(0, 10)
      .map(p => ({ key: p.key, lastAccess: p.lastAccess! }));
  }
  
  private calculateCacheEfficiency(): void {
    // Calculate memory saved (cache hits * average response size)
    const avgSize = 50 * 1024; // 50KB average
    const cacheHits = Object.values(this.metrics.tiers)
      .reduce((sum, tier) => sum + tier.hits, 0);
    
    this.metrics.cacheEfficiency.memorySavedBytes = cacheHits * avgSize;
    this.metrics.cacheEfficiency.apiCallsSaved = cacheHits;
  }
}
```

### Integration with Storage Layer
```typescript
// Update storage-integration.ts
let statisticsCollector: EnhancedStatisticsCollector;

export function initializeStatistics(): void {
  statisticsCollector = new EnhancedStatisticsCollector();
}

export async function getCachedData<T>(
  cacheKey: string,
  fetchFunction: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const startTime = Date.now();
  const { framework, resourceType } = parseCacheKey(cacheKey);
  
  try {
    if (!isStorageInitialized()) {
      return fetchFunction();
    }

    const storage = getStorage();
    
    // Check cache
    const cached = await storage.get(cacheKey);
    if (cached) {
      statisticsCollector.recordCacheAccess({
        tier: await determineTier(cacheKey),
        hit: true,
        responseTime: Date.now() - startTime,
        framework,
        resourceType,
        key: cacheKey,
        bytesServed: JSON.stringify(cached).length
      });
      
      return cached;
    }
    
    // Cache miss - fetch data
    const data = await fetchFunction();
    
    statisticsCollector.recordCacheAccess({
      tier: 'github',
      hit: false,
      responseTime: Date.now() - startTime,
      framework,
      resourceType,
      key: cacheKey,
      bytesServed: JSON.stringify(data).length
    });
    
    // Store in cache
    await storage.set(cacheKey, data, ttl);
    
    return data;
    
  } catch (error) {
    logger.error('Cache operation failed:', error);
    return fetchFunction();
  }
}

function parseCacheKey(key: string): { framework?: string; resourceType?: string } {
  const parts = key.split(':');
  
  const resourceType = parts[0] as any;
  const framework = ['react', 'svelte'].includes(parts[1]) ? parts[1] : undefined;
  
  return { framework, resourceType };
}
```

### CLI Integration
```typescript
// Update cache stats command
export async function showCacheStats(): Promise<void> {
  const stats = statisticsCollector.getStatistics();
  
  // Overall performance table
  console.log(chalk.bold('\n📊 Overall Performance'));
  const overallTable = new Table({
    head: ['Metric', 'Value'],
    style: { head: ['cyan'] }
  });
  
  overallTable.push(
    ['Total Requests', stats.overall.totalRequests.toLocaleString()],
    ['Cache Hit Rate', `${stats.overall.cacheHitRate.toFixed(2)}%`],
    ['Avg Response Time', `${stats.overall.avgResponseTime.toFixed(2)}ms`],
    ['P95 Response Time', `${stats.overall.p95ResponseTime.toFixed(2)}ms`],
    ['P99 Response Time', `${stats.overall.p99ResponseTime.toFixed(2)}ms`]
  );
  
  console.log(overallTable.toString());
  
  // Tier breakdown
  console.log(chalk.bold('\n🏗️  Storage Tier Performance'));
  const tierTable = new Table({
    head: ['Tier', 'Hits', 'Misses', 'Hit Rate', 'Avg Response', 'Data Served'],
    style: { head: ['cyan'] }
  });
  
  for (const [tier, data] of Object.entries(stats.tiers)) {
    const hitRate = data.hits + data.misses > 0 
      ? (data.hits / (data.hits + data.misses) * 100).toFixed(2) 
      : '0.00';
      
    tierTable.push([
      tier.toUpperCase(),
      data.hits.toLocaleString(),
      data.misses.toLocaleString(),
      `${hitRate}%`,
      `${data.avgResponseTime.toFixed(2)}ms`,
      formatBytes(data.bytesServed)
    ]);
  }
  
  console.log(tierTable.toString());
  
  // Framework breakdown
  console.log(chalk.bold('\n🎨 Framework Usage'));
  const frameworkTable = new Table({
    head: ['Framework', 'Requests', 'Unique Components', 'Hit Rate', 'Top Component'],
    style: { head: ['cyan'] }
  });
  
  for (const [framework, data] of Object.entries(stats.frameworks)) {
    const topComponent = data.popularComponents[0];
    
    frameworkTable.push([
      framework.charAt(0).toUpperCase() + framework.slice(1),
      data.requestCount.toLocaleString(),
      data.uniqueComponents.toString(),
      `${data.cacheHitRate.toFixed(2)}%`,
      topComponent ? `${topComponent.name} (${topComponent.accessCount})` : 'N/A'
    ]);
  }
  
  console.log(frameworkTable.toString());
  
  // Cache efficiency
  console.log(chalk.bold('\n💰 Cache Efficiency'));
  console.log(`API Calls Saved: ${chalk.green(stats.cacheEfficiency.apiCallsSaved.toLocaleString())}`);
  console.log(`Memory Saved: ${chalk.green(formatBytes(stats.cacheEfficiency.memorySavedBytes))}`);
  console.log(`Evictions: ${stats.cacheEfficiency.evictionCount}`);
  
  // Hot keys
  if (stats.cacheEfficiency.hotKeys.length > 0) {
    console.log(chalk.bold('\n🔥 Hot Keys'));
    stats.cacheEfficiency.hotKeys.slice(0, 5).forEach(key => {
      console.log(`  ${key.key}: ${key.accessCount} accesses`);
    });
  }
}
```

## Acceptance Criteria
- [ ] Detailed tier-specific performance metrics collected
- [ ] Framework-specific usage patterns tracked
- [ ] Resource type breakdown available
- [ ] GitHub API usage and rate limits monitored
- [ ] Response time percentiles calculated accurately
- [ ] Cache efficiency metrics provide actionable insights
- [ ] Hot/cold key analysis identifies optimization opportunities
- [ ] CLI displays comprehensive statistics clearly

## Testing Requirements
- Unit tests for statistics calculations
- Integration tests with storage layer
- Performance tests for statistics overhead
- Accuracy tests for percentile calculations
- Memory usage tests for statistics storage

## Estimated Effort
- 6-8 hours

## Dependencies
- Existing statistics collection
- Storage integration layer
- CLI cache stats command

## Notes
- Consider adding export functionality for metrics
- Future: Prometheus/Grafana integration
- Add configurable retention period for statistics
- Consider persistent statistics storage