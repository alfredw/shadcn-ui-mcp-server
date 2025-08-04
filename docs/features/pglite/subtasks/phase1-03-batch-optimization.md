# Phase 1, Task 3: Batch Operation Optimization

## Overview
Optimize batch operations for fetching multiple components or resources simultaneously. This will significantly improve performance when tools need to fetch lists of components or related resources.

## Objectives
- Optimize `getCachedDataBatch()` for parallel execution
- Implement intelligent request grouping
- Minimize total API calls through smart batching
- Improve response times for list operations
- Add batch-specific caching strategies

## Technical Requirements

### Current Batch Implementation Analysis
The current `getCachedDataBatch()` in `storage-integration.ts` processes requests sequentially. We need to optimize this for:
1. Parallel cache checks
2. Grouped GitHub API calls
3. Smart result sharing
4. Optimal concurrency limits

### Enhanced Batch Implementation
```typescript
export interface BatchRequest<T> {
  key: string;
  fetchFunction: () => Promise<T>;
  ttl?: number;
  priority?: 'high' | 'normal' | 'low';
}

export interface BatchOptions {
  maxConcurrency?: number;
  groupingStrategy?: 'none' | 'prefix' | 'custom';
  customGrouper?: (key: string) => string;
  deduplication?: boolean;
}

export class BatchProcessor {
  private readonly defaultConcurrency = 5;
  
  async processBatch<T>(
    requests: BatchRequest<T>[],
    options: BatchOptions = {}
  ): Promise<T[]> {
    const {
      maxConcurrency = this.defaultConcurrency,
      groupingStrategy = 'prefix',
      deduplication = true
    } = options;
    
    // Step 1: Deduplicate if enabled
    const { uniqueRequests, indexMap } = deduplication 
      ? this.deduplicateRequests(requests)
      : { uniqueRequests: requests, indexMap: null };
    
    // Step 2: Check cache for all keys in parallel
    const cacheResults = await this.checkCacheBatch(uniqueRequests);
    
    // Step 3: Group uncached requests
    const uncachedRequests = uniqueRequests.filter((_, i) => !cacheResults[i].found);
    const groups = this.groupRequests(uncachedRequests, groupingStrategy, options.customGrouper);
    
    // Step 4: Process groups with concurrency control
    const fetchResults = await this.processGroups(groups, maxConcurrency);
    
    // Step 5: Merge results
    const finalResults = this.mergeResults(uniqueRequests, cacheResults, fetchResults);
    
    // Step 6: Map back to original order if deduplicated
    return indexMap ? this.remapResults(finalResults, indexMap) : finalResults;
  }
  
  private async checkCacheBatch<T>(
    requests: BatchRequest<T>[]
  ): Promise<Array<{ found: boolean; data?: T }>> {
    const storage = getStorage();
    
    // Use mget for efficient batch cache lookup
    const keys = requests.map(r => r.key);
    const cachedValues = await storage.mget(keys);
    
    return cachedValues.map((value, index) => ({
      found: value !== undefined,
      data: value
    }));
  }
  
  private groupRequests<T>(
    requests: BatchRequest<T>[],
    strategy: string,
    customGrouper?: (key: string) => string
  ): Map<string, BatchRequest<T>[]> {
    const groups = new Map<string, BatchRequest<T>[]>();
    
    requests.forEach(request => {
      let groupKey: string;
      
      switch (strategy) {
        case 'prefix':
          // Group by key prefix (e.g., all 'component:react:*' together)
          groupKey = request.key.split(':').slice(0, 2).join(':');
          break;
        case 'custom':
          groupKey = customGrouper ? customGrouper(request.key) : 'default';
          break;
        default:
          groupKey = 'default';
      }
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(request);
    });
    
    return groups;
  }
  
  private async processGroups<T>(
    groups: Map<string, BatchRequest<T>[]>,
    maxConcurrency: number
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const groupEntries = Array.from(groups.entries());
    
    // Process groups with concurrency control
    for (let i = 0; i < groupEntries.length; i += maxConcurrency) {
      const batch = groupEntries.slice(i, i + maxConcurrency);
      
      const batchResults = await Promise.all(
        batch.map(([groupKey, requests]) => 
          this.processGroup(groupKey, requests)
        )
      );
      
      // Merge batch results
      batchResults.forEach(groupResult => {
        groupResult.forEach((value, key) => {
          results.set(key, value);
        });
      });
    }
    
    return results;
  }
  
  private async processGroup<T>(
    groupKey: string,
    requests: BatchRequest<T>[]
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    // Check if we can optimize this group
    if (this.canOptimizeGroup(groupKey, requests)) {
      return this.optimizedGroupFetch(groupKey, requests);
    }
    
    // Otherwise, process individually with concurrency
    const fetchPromises = requests.map(async request => {
      try {
        const data = await request.fetchFunction();
        await this.cacheResult(request.key, data, request.ttl);
        results.set(request.key, data);
      } catch (error) {
        logger.error(`Batch fetch failed for ${request.key}:`, error);
        throw error;
      }
    });
    
    await Promise.all(fetchPromises);
    return results;
  }
  
  private canOptimizeGroup(groupKey: string, requests: BatchRequest<any>[]): boolean {
    // Check if this group can be optimized with a single API call
    // For example, all components in the same directory
    if (groupKey.startsWith('component:')) {
      const paths = requests.map(r => this.extractPath(r.key));
      const directory = paths[0]?.split('/').slice(0, -1).join('/');
      return paths.every(p => p.startsWith(directory));
    }
    
    return false;
  }
  
  private async optimizedGroupFetch<T>(
    groupKey: string,
    requests: BatchRequest<T>[]
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    if (groupKey.startsWith('component:')) {
      // Fetch entire directory in one API call
      const directory = this.extractCommonDirectory(requests);
      const axios = await getAxiosImplementation();
      
      try {
        const directoryContents = await axios.buildDirectoryTree(directory);
        
        // Extract individual files from directory response
        for (const request of requests) {
          const fileName = this.extractFileName(request.key);
          const fileData = this.findFileInTree(directoryContents, fileName);
          
          if (fileData) {
            results.set(request.key, fileData as T);
            await this.cacheResult(request.key, fileData as T, request.ttl);
          } else {
            // Fallback to individual fetch
            const data = await request.fetchFunction();
            results.set(request.key, data);
            await this.cacheResult(request.key, data, request.ttl);
          }
        }
      } catch (error) {
        // Fallback to individual fetches
        logger.warn(`Optimized group fetch failed, falling back to individual:`, error);
        
        for (const request of requests) {
          const data = await request.fetchFunction();
          results.set(request.key, data);
          await this.cacheResult(request.key, data, request.ttl);
        }
      }
    }
    
    return results;
  }
}
```

### Integration with Existing Code
```typescript
// Enhanced getCachedDataBatch in storage-integration.ts
const batchProcessor = new BatchProcessor();

export async function getCachedDataBatch<T>(
  requests: Array<{
    key: string;
    fetchFunction: () => Promise<T>;
    ttl?: number;
  }>,
  options?: BatchOptions
): Promise<T[]> {
  try {
    if (!isStorageInitialized()) {
      // Fallback to sequential processing
      return Promise.all(requests.map(r => r.fetchFunction()));
    }
    
    return batchProcessor.processBatch(requests, options);
    
  } catch (error) {
    logger.error('Batch operation failed:', error);
    // Fallback to sequential processing
    return Promise.all(requests.map(r => r.fetchFunction()));
  }
}
```

### Optimized Tool Usage
```typescript
// Example: Optimize list-components tool
export async function listComponentsOptimized(
  framework: 'react' | 'svelte'
): Promise<ComponentMetadata[]> {
  const axios = await getAxiosImplementation();
  const componentNames = await axios.getAvailableComponents();
  
  // Batch fetch all component metadata
  const requests = componentNames.map(name => ({
    key: generateComponentMetadataKey(framework, name),
    fetchFunction: () => axios.getComponentMetadata(name),
    ttl: 3600000 // 1 hour
  }));
  
  const metadataList = await getCachedDataBatch(requests, {
    maxConcurrency: 10,
    groupingStrategy: 'prefix',
    deduplication: true
  });
  
  return metadataList;
}
```

### Performance Monitoring
```typescript
export interface BatchPerformanceMetrics {
  totalRequests: number;
  cachedRequests: number;
  fetchedRequests: number;
  optimizedGroups: number;
  totalTime: number;
  avgTimePerRequest: number;
  concurrencyUtilization: number;
}

export class BatchPerformanceMonitor {
  private metrics: BatchPerformanceMetrics[] = [];
  
  recordBatch(metrics: BatchPerformanceMetrics): void {
    this.metrics.push(metrics);
    
    // Keep only last 100 batches
    if (this.metrics.length > 100) {
      this.metrics.shift();
    }
  }
  
  getAverageMetrics(): BatchPerformanceMetrics {
    if (this.metrics.length === 0) {
      return this.emptyMetrics();
    }
    
    const sum = this.metrics.reduce((acc, m) => ({
      totalRequests: acc.totalRequests + m.totalRequests,
      cachedRequests: acc.cachedRequests + m.cachedRequests,
      fetchedRequests: acc.fetchedRequests + m.fetchedRequests,
      optimizedGroups: acc.optimizedGroups + m.optimizedGroups,
      totalTime: acc.totalTime + m.totalTime,
      avgTimePerRequest: 0, // Calculate after
      concurrencyUtilization: acc.concurrencyUtilization + m.concurrencyUtilization
    }), this.emptyMetrics());
    
    const count = this.metrics.length;
    
    return {
      totalRequests: sum.totalRequests / count,
      cachedRequests: sum.cachedRequests / count,
      fetchedRequests: sum.fetchedRequests / count,
      optimizedGroups: sum.optimizedGroups / count,
      totalTime: sum.totalTime / count,
      avgTimePerRequest: sum.totalTime / sum.totalRequests,
      concurrencyUtilization: sum.concurrencyUtilization / count
    };
  }
}
```

### Configuration
```typescript
// Add to configuration schema
export const batchConfigSchema = z.object({
  batch: z.object({
    defaultConcurrency: z.number().min(1).max(20).default(5),
    enableOptimizations: z.boolean().default(true),
    groupingStrategy: z.enum(['none', 'prefix', 'custom']).default('prefix'),
    maxBatchSize: z.number().min(1).max(100).default(50),
    timeoutMs: z.number().min(1000).max(60000).default(30000)
  })
});
```

## Acceptance Criteria
- [ ] Batch operations process requests in parallel
- [ ] Intelligent grouping reduces total API calls
- [ ] Deduplication prevents redundant fetches
- [ ] Concurrency limits prevent overwhelming GitHub API
- [ ] Performance metrics track batch efficiency
- [ ] Fallback mechanisms handle failures gracefully
- [ ] Response times improve by at least 50% for large batches

## Testing Requirements
- Unit tests for BatchProcessor class
- Integration tests with real storage
- Performance benchmarks comparing old vs new implementation
- Stress tests with large batches
- Error handling tests for partial failures
- Concurrency limit tests

## Estimated Effort
- 8-10 hours

## Dependencies
- Existing storage-integration.ts
- Hybrid storage mget support
- Statistics collection system

## Example Usage
```typescript
// Fetch multiple components efficiently
const components = ['button', 'card', 'dialog', 'alert', 'badge'];

const requests = components.map(name => ({
  key: `component:react:${name}`,
  fetchFunction: () => fetchComponentData(name),
  ttl: 3600000
}));

// Old way: ~500ms for 5 sequential fetches
const oldResults = await Promise.all(requests.map(r => getCachedData(r.key, r.fetchFunction, r.ttl)));

// New way: ~150ms with parallel processing and optimizations
const newResults = await getCachedDataBatch(requests, {
  maxConcurrency: 5,
  groupingStrategy: 'prefix'
});

// Batch fetch with priority
const prioritizedRequests = components.map((name, i) => ({
  key: `component:react:${name}`,
  fetchFunction: () => fetchComponentData(name),
  ttl: 3600000,
  priority: i < 2 ? 'high' : 'normal'
}));

const prioritizedResults = await getCachedDataBatch(prioritizedRequests);
```

## Notes
- Monitor memory usage with large batches
- Consider implementing streaming for very large results
- Future: Add batch prefetching for predictive loading
- Consider WebSocket support for real-time batch updates