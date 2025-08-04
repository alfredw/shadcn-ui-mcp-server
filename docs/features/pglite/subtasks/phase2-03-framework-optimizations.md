# Phase 2, Task 3: Framework-Specific Optimizations

## Overview
Implement framework-specific optimizations for React and Svelte that take advantage of each framework's unique characteristics and usage patterns. This includes tailored caching strategies, TTL configurations, and prefetching logic.

## Objectives
- Implement different caching strategies per framework
- Optimize TTL values based on framework update patterns
- Add framework-specific prefetching logic
- Create usage pattern analysis for each framework
- Implement framework-aware cache warming

## Technical Requirements

### Framework Strategy Manager
```typescript
export interface FrameworkStrategy {
  name: 'react' | 'svelte';
  cache: {
    componentTTL: number;
    demoTTL: number;
    metadataTTL: number;
    listTTL: number;
  };
  prefetch: {
    enabled: boolean;
    patterns: string[];
    relatedComponents: Map<string, string[]>;
  };
  optimization: {
    bundleRelated: boolean;
    compressThreshold: number;
    parallelFetchLimit: number;
  };
}

export class FrameworkStrategyManager {
  private strategies: Map<string, FrameworkStrategy>;
  private usageAnalyzer: UsagePatternAnalyzer;
  
  constructor(private config: ConfigurationManager) {
    this.strategies = new Map();
    this.usageAnalyzer = new UsagePatternAnalyzer();
    
    this.initializeStrategies();
  }
  
  private initializeStrategies(): void {
    // React strategy - more stable, longer TTLs
    this.strategies.set('react', {
      name: 'react',
      cache: {
        componentTTL: 7200000, // 2 hours
        demoTTL: 3600000,      // 1 hour
        metadataTTL: 1800000,  // 30 minutes
        listTTL: 900000        // 15 minutes
      },
      prefetch: {
        enabled: true,
        patterns: [
          // Common React patterns
          'button', 'card', 'dialog', 'form',
          'input', 'select', 'table', 'tabs'
        ],
        relatedComponents: new Map([
          ['form', ['input', 'select', 'checkbox', 'radio', 'label']],
          ['dialog', ['button', 'card']],
          ['table', ['checkbox', 'dropdown-menu']],
          ['tabs', ['card']]
        ])
      },
      optimization: {
        bundleRelated: true,
        compressThreshold: 10240, // 10KB
        parallelFetchLimit: 5
      }
    });
    
    // Svelte strategy - more dynamic, shorter TTLs
    this.strategies.set('svelte', {
      name: 'svelte',
      cache: {
        componentTTL: 3600000,  // 1 hour
        demoTTL: 1800000,       // 30 minutes
        metadataTTL: 900000,    // 15 minutes
        listTTL: 600000         // 10 minutes
      },
      prefetch: {
        enabled: true,
        patterns: [
          // Common Svelte patterns
          'button', 'card', 'sheet', 'accordion',
          'alert', 'badge', 'combobox', 'command'
        ],
        relatedComponents: new Map([
          ['sheet', ['button']],
          ['combobox', ['command', 'popover']],
          ['accordion', ['card']],
          ['alert-dialog', ['button', 'alert']]
        ])
      },
      optimization: {
        bundleRelated: true,
        compressThreshold: 8192, // 8KB
        parallelFetchLimit: 3
      }
    });
  }
  
  getStrategy(framework: 'react' | 'svelte'): FrameworkStrategy {
    const strategy = this.strategies.get(framework);
    if (!strategy) {
      throw new Error(`No strategy found for framework: ${framework}`);
    }
    
    // Adjust based on usage patterns
    return this.adjustStrategyBasedOnUsage(strategy);
  }
  
  private adjustStrategyBasedOnUsage(
    strategy: FrameworkStrategy
  ): FrameworkStrategy {
    const usage = this.usageAnalyzer.getFrameworkUsage(strategy.name);
    
    // Adjust TTLs based on access frequency
    if (usage.accessFrequency > 100) {
      // High frequency - increase TTLs
      return {
        ...strategy,
        cache: {
          componentTTL: strategy.cache.componentTTL * 1.5,
          demoTTL: strategy.cache.demoTTL * 1.5,
          metadataTTL: strategy.cache.metadataTTL * 1.5,
          listTTL: strategy.cache.listTTL * 1.5
        }
      };
    }
    
    return strategy;
  }
}
```

### Usage Pattern Analyzer
```typescript
export interface UsagePattern {
  framework: string;
  componentAccess: Map<string, AccessMetrics>;
  accessSequences: string[][];
  peakHours: number[];
  averageSessionDuration: number;
}

export interface AccessMetrics {
  count: number;
  lastAccess: Date;
  averageLoadTime: number;
  cacheHitRate: number;
}

export class UsagePatternAnalyzer {
  private patterns: Map<string, UsagePattern> = new Map();
  private sessionTracker: SessionTracker;
  
  constructor() {
    this.sessionTracker = new SessionTracker();
    this.startAnalysis();
  }
  
  recordAccess(
    framework: string,
    component: string,
    metrics: Partial<AccessMetrics>
  ): void {
    const pattern = this.getOrCreatePattern(framework);
    const componentMetrics = pattern.componentAccess.get(component) || {
      count: 0,
      lastAccess: new Date(),
      averageLoadTime: 0,
      cacheHitRate: 0
    };
    
    // Update metrics
    componentMetrics.count++;
    componentMetrics.lastAccess = new Date();
    
    if (metrics.averageLoadTime !== undefined) {
      componentMetrics.averageLoadTime = 
        (componentMetrics.averageLoadTime * (componentMetrics.count - 1) + 
         metrics.averageLoadTime) / componentMetrics.count;
    }
    
    pattern.componentAccess.set(component, componentMetrics);
    
    // Track access sequence
    this.sessionTracker.recordAccess(framework, component);
  }
  
  getPopularComponents(
    framework: string,
    limit: number = 10
  ): Array<{ name: string; metrics: AccessMetrics }> {
    const pattern = this.patterns.get(framework);
    if (!pattern) return [];
    
    return Array.from(pattern.componentAccess.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([name, metrics]) => ({ name, metrics }));
  }
  
  predictNextComponents(
    framework: string,
    currentComponent: string,
    limit: number = 5
  ): string[] {
    const pattern = this.patterns.get(framework);
    if (!pattern) return [];
    
    const predictions = new Map<string, number>();
    
    // Analyze access sequences
    pattern.accessSequences.forEach(sequence => {
      const index = sequence.indexOf(currentComponent);
      if (index >= 0 && index < sequence.length - 1) {
        const next = sequence[index + 1];
        predictions.set(next, (predictions.get(next) || 0) + 1);
      }
    });
    
    // Sort by frequency
    return Array.from(predictions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([component]) => component);
  }
  
  getOptimalPrefetchList(
    framework: string,
    baseComponent: string
  ): string[] {
    const strategy = new FrameworkStrategyManager(getConfig())
      .getStrategy(framework as 'react' | 'svelte');
    
    const prefetchList: Set<string> = new Set();
    
    // Add related components from strategy
    const related = strategy.prefetch.relatedComponents.get(baseComponent);
    if (related) {
      related.forEach(comp => prefetchList.add(comp));
    }
    
    // Add predicted next components
    const predicted = this.predictNextComponents(framework, baseComponent);
    predicted.forEach(comp => prefetchList.add(comp));
    
    // Add popular components that aren't cached
    const popular = this.getPopularComponents(framework, 5);
    for (const { name } of popular) {
      if (!prefetchList.has(name)) {
        prefetchList.add(name);
        if (prefetchList.size >= 10) break;
      }
    }
    
    return Array.from(prefetchList);
  }
}
```

### Framework-Optimized Cache
```typescript
export class FrameworkOptimizedCache {
  private strategyManager: FrameworkStrategyManager;
  private storage: HybridStorage;
  private prefetchQueue: PrefetchQueue;
  
  constructor(
    private framework: 'react' | 'svelte',
    config: ConfigurationManager
  ) {
    this.strategyManager = new FrameworkStrategyManager(config);
    this.storage = new HybridStorage(config.get('storage'));
    this.prefetchQueue = new PrefetchQueue(this.framework);
  }
  
  async get(key: string): Promise<any> {
    const result = await this.storage.get(key);
    
    if (result) {
      // Trigger prefetch for related components
      this.triggerPrefetch(key);
    }
    
    return result;
  }
  
  async set(key: string, value: any, customTTL?: number): Promise<void> {
    const strategy = this.strategyManager.getStrategy(this.framework);
    const ttl = customTTL || this.getTTLForKey(key, strategy);
    
    // Apply compression if needed
    const finalValue = this.shouldCompress(value, strategy)
      ? await this.compress(value)
      : value;
    
    await this.storage.set(key, finalValue, ttl);
  }
  
  private getTTLForKey(key: string, strategy: FrameworkStrategy): number {
    if (key.includes(':component:')) return strategy.cache.componentTTL;
    if (key.includes(':demo:')) return strategy.cache.demoTTL;
    if (key.includes(':metadata:')) return strategy.cache.metadataTTL;
    if (key.includes(':list:')) return strategy.cache.listTTL;
    
    return 3600000; // Default 1 hour
  }
  
  private async triggerPrefetch(accessedKey: string): Promise<void> {
    const componentName = this.extractComponentName(accessedKey);
    if (!componentName) return;
    
    const analyzer = new UsagePatternAnalyzer();
    const toPrefetch = analyzer.getOptimalPrefetchList(
      this.framework,
      componentName
    );
    
    // Queue prefetch operations
    for (const component of toPrefetch) {
      this.prefetchQueue.add({
        component,
        priority: this.calculatePriority(component),
        framework: this.framework
      });
    }
  }
  
  private calculatePriority(component: string): number {
    const analyzer = new UsagePatternAnalyzer();
    const popular = analyzer.getPopularComponents(this.framework);
    
    const index = popular.findIndex(p => p.name === component);
    return index >= 0 ? 10 - index : 5;
  }
}
```

### Prefetch Queue Implementation
```typescript
export class PrefetchQueue {
  private queue: PriorityQueue<PrefetchTask>;
  private inProgress = new Set<string>();
  private maxConcurrent: number;
  
  constructor(private framework: 'react' | 'svelte') {
    this.queue = new PriorityQueue((a, b) => b.priority - a.priority);
    this.maxConcurrent = framework === 'react' ? 5 : 3;
    
    this.startProcessor();
  }
  
  add(task: PrefetchTask): void {
    const key = `${task.framework}:${task.component}`;
    
    // Skip if already in progress or queued
    if (this.inProgress.has(key)) return;
    if (this.queue.contains(t => `${t.framework}:${t.component}` === key)) return;
    
    this.queue.enqueue(task);
  }
  
  private async startProcessor(): Promise<void> {
    while (true) {
      if (this.inProgress.size >= this.maxConcurrent || this.queue.isEmpty()) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      const task = this.queue.dequeue();
      if (!task) continue;
      
      const key = `${task.framework}:${task.component}`;
      this.inProgress.add(key);
      
      // Process in background
      this.processTask(task)
        .finally(() => {
          this.inProgress.delete(key);
        })
        .catch(error => {
          logger.error(`Prefetch failed for ${key}:`, error);
        });
    }
  }
  
  private async processTask(task: PrefetchTask): Promise<void> {
    const cacheKey = `component:${task.framework}:${task.component}`;
    
    // Check if already cached
    const cached = await getStorage().get(cacheKey);
    if (cached) return;
    
    // Fetch component
    const axios = await getAxiosImplementation();
    const data = await axios.getComponentSource(task.component);
    
    // Cache with framework-specific TTL
    const strategy = new FrameworkStrategyManager(getConfig())
      .getStrategy(task.framework);
    
    await getStorage().set(cacheKey, data, strategy.cache.componentTTL);
    
    logger.debug(`Prefetched ${task.component} for ${task.framework}`);
  }
}

interface PrefetchTask {
  component: string;
  framework: 'react' | 'svelte';
  priority: number;
}
```

### Framework-Specific CLI Commands
```typescript
// Add framework-specific cache warming
export async function warmFrameworkCache(
  framework: 'react' | 'svelte',
  options: {
    components?: string[];
    popular?: number;
    related?: boolean;
  }
): Promise<void> {
  const spinner = ora(`Warming ${framework} cache...`).start();
  
  try {
    const analyzer = new UsagePatternAnalyzer();
    const strategy = new FrameworkStrategyManager(getConfig())
      .getStrategy(framework);
    
    let componentsToWarm: string[] = [];
    
    if (options.components) {
      // Specific components requested
      componentsToWarm = options.components;
    } else if (options.popular) {
      // Warm popular components
      const popular = analyzer.getPopularComponents(framework, options.popular);
      componentsToWarm = popular.map(p => p.name);
    } else {
      // Default patterns from strategy
      componentsToWarm = strategy.prefetch.patterns;
    }
    
    // Add related components if requested
    if (options.related) {
      const additionalComponents = new Set<string>();
      
      for (const component of componentsToWarm) {
        const related = strategy.prefetch.relatedComponents.get(component);
        if (related) {
          related.forEach(r => additionalComponents.add(r));
        }
      }
      
      componentsToWarm.push(...additionalComponents);
    }
    
    // Remove duplicates
    componentsToWarm = [...new Set(componentsToWarm)];
    
    spinner.text = `Warming cache for ${componentsToWarm.length} ${framework} components...`;
    
    // Warm cache in batches
    const axios = await getAxiosImplementation();
    const batchSize = strategy.optimization.parallelFetchLimit;
    
    for (let i = 0; i < componentsToWarm.length; i += batchSize) {
      const batch = componentsToWarm.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async component => {
          const cacheKey = `component:${framework}:${component}`;
          
          try {
            const data = await axios.getComponentSource(component);
            await getStorage().set(cacheKey, data, strategy.cache.componentTTL);
          } catch (error) {
            logger.error(`Failed to warm ${component}:`, error);
          }
        })
      );
      
      spinner.text = `Warmed ${Math.min(i + batchSize, componentsToWarm.length)}/${componentsToWarm.length} components...`;
    }
    
    spinner.succeed(`Successfully warmed ${framework} cache with ${componentsToWarm.length} components`);
    
  } catch (error) {
    spinner.fail(`Failed to warm ${framework} cache`);
    throw error;
  }
}
```

## Acceptance Criteria
- [ ] Framework-specific strategies properly configured
- [ ] Different TTLs applied based on framework
- [ ] Usage pattern analysis tracks access correctly
- [ ] Prefetching works for related components
- [ ] Popular components identified accurately
- [ ] Cache warming command works per framework
- [ ] Performance optimizations measurable
- [ ] Framework switching maintains separate caches

## Testing Requirements
- Unit tests for FrameworkStrategyManager
- Usage pattern analysis accuracy tests
- Prefetch queue behavior tests
- Framework-specific TTL tests
- Cache warming integration tests
- Performance comparison tests between frameworks
- Concurrency limit tests

## Estimated Effort
- 8-10 hours

## Dependencies
- Existing axios implementations
- Hybrid storage system
- CLI infrastructure
- Usage statistics collection

## Notes
- Monitor prefetch effectiveness
- Consider A/B testing different strategies
- Add framework migration support
- Track framework-specific error patterns