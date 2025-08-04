# Phase 3, Task 1: Simple Prefetching

## Overview
Implement a simple, practical prefetching system that improves performance without the complexity of machine learning or advanced prediction models. Focus on common usage patterns and static relationships between components.

## Objectives
- Implement basic prefetching for commonly related components
- Add simple usage counting for popular components
- Create a lightweight prefetch queue
- Support manual prefetch hints
- Keep implementation simple and maintainable

## Technical Requirements

### Simple Prefetch Manager
```typescript
export interface PrefetchConfig {
  enabled: boolean;
  maxConcurrent: number;
  popularThreshold: number; // Access count to consider "popular"
  relatedComponents: Map<string, string[]>;
}

export class SimplePrefetchManager {
  private accessCounts = new Map<string, number>();
  private prefetchQueue: string[] = [];
  private inProgress = new Set<string>();
  
  constructor(
    private storage: HybridStorage,
    private config: PrefetchConfig
  ) {
    this.initializeRelatedComponents();
  }
  
  private initializeRelatedComponents(): void {
    // Define common component relationships
    this.config.relatedComponents = new Map([
      // Form-related components
      ['form', ['input', 'select', 'checkbox', 'button', 'label']],
      ['input', ['label', 'button']],
      ['select', ['label', 'popover']],
      
      // Dialog/Modal related
      ['dialog', ['button', 'card']],
      ['alert-dialog', ['button', 'alert']],
      ['sheet', ['button']],
      
      // Data display
      ['table', ['checkbox', 'dropdown-menu', 'button']],
      ['data-table', ['table', 'input', 'button', 'dropdown-menu']],
      
      // Navigation
      ['tabs', ['card']],
      ['accordion', ['card']],
      ['navigation-menu', ['button']]
    ]);
  }
  
  async recordAccess(componentName: string, framework: string): Promise<void> {
    // Update access count
    const key = `${framework}:${componentName}`;
    this.accessCounts.set(key, (this.accessCounts.get(key) || 0) + 1);
    
    if (!this.config.enabled) return;
    
    // Prefetch related components
    const related = this.config.relatedComponents.get(componentName) || [];
    
    for (const relatedComponent of related) {
      const cacheKey = `component:${framework}:${relatedComponent}`;
      
      // Check if already cached
      const exists = await this.storage.has(cacheKey);
      if (!exists && !this.inProgress.has(cacheKey)) {
        this.prefetchQueue.push(cacheKey);
      }
    }
    
    // Process queue
    this.processQueue();
  }
  
  private async processQueue(): Promise<void> {
    while (
      this.prefetchQueue.length > 0 && 
      this.inProgress.size < this.config.maxConcurrent
    ) {
      const cacheKey = this.prefetchQueue.shift()!;
      
      if (this.inProgress.has(cacheKey)) continue;
      
      this.inProgress.add(cacheKey);
      
      // Prefetch in background
      this.prefetchComponent(cacheKey)
        .then(() => {
          logger.debug(`Prefetched ${cacheKey}`);
        })
        .catch(error => {
          logger.error(`Failed to prefetch ${cacheKey}:`, error);
        })
        .finally(() => {
          this.inProgress.delete(cacheKey);
          // Try to process more items
          this.processQueue();
        });
    }
  }
  
  private async prefetchComponent(cacheKey: string): Promise<void> {
    // Extract component info from cache key
    const parts = cacheKey.split(':');
    const framework = parts[1] as 'react' | 'svelte';
    const componentName = parts[2];
    
    // Use getCachedData to fetch and cache
    const axios = await getAxiosImplementation();
    await getCachedData(
      cacheKey,
      () => axios.getComponentSource(componentName),
      3600000 // 1 hour TTL
    );
  }
  
  getPopularComponents(framework: string, limit: number = 10): string[] {
    return Array.from(this.accessCounts.entries())
      .filter(([key]) => key.startsWith(`${framework}:`))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .filter(([_, count]) => count >= this.config.popularThreshold)
      .map(([key]) => key.split(':')[1]);
  }
  
  // Manual prefetch method
  async prefetchComponents(
    components: string[],
    framework: string
  ): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];
    
    for (const component of components) {
      try {
        const cacheKey = `component:${framework}:${component}`;
        await this.prefetchComponent(cacheKey);
        success.push(component);
      } catch (error) {
        failed.push(component);
      }
    }
    
    return { success, failed };
  }
}
```

### Usage Statistics Tracker
```typescript
export class SimpleUsageTracker {
  private stats: Map<string, ComponentStats> = new Map();
  
  recordAccess(
    component: string,
    framework: string,
    responseTime: number,
    cacheHit: boolean
  ): void {
    const key = `${framework}:${component}`;
    
    const current = this.stats.get(key) || {
      accessCount: 0,
      cacheHits: 0,
      totalResponseTime: 0,
      lastAccess: new Date()
    };
    
    current.accessCount++;
    if (cacheHit) current.cacheHits++;
    current.totalResponseTime += responseTime;
    current.lastAccess = new Date();
    
    this.stats.set(key, current);
  }
  
  getTopComponents(
    framework?: string,
    limit: number = 20
  ): Array<{ component: string; stats: ComponentStats }> {
    const entries = Array.from(this.stats.entries());
    
    const filtered = framework
      ? entries.filter(([key]) => key.startsWith(`${framework}:`))
      : entries;
    
    return filtered
      .sort((a, b) => b[1].accessCount - a[1].accessCount)
      .slice(0, limit)
      .map(([key, stats]) => ({
        component: key.split(':')[1],
        stats
      }));
  }
  
  // Get components accessed in the last N minutes
  getRecentlyAccessed(minutes: number = 30): string[] {
    const threshold = Date.now() - (minutes * 60 * 1000);
    
    return Array.from(this.stats.entries())
      .filter(([_, stats]) => stats.lastAccess.getTime() > threshold)
      .map(([key]) => key);
  }
}

interface ComponentStats {
  accessCount: number;
  cacheHits: number;
  totalResponseTime: number;
  lastAccess: Date;
}
```

### Static Component Groups
```typescript
// Define common component groups for bulk operations
export const COMPONENT_GROUPS = {
  forms: ['form', 'input', 'textarea', 'select', 'checkbox', 'radio', 'switch', 'label', 'button'],
  layout: ['card', 'separator', 'aspect-ratio', 'scroll-area'],
  navigation: ['tabs', 'navigation-menu', 'breadcrumb', 'pagination'],
  dataDisplay: ['table', 'badge', 'avatar', 'progress'],
  feedback: ['alert', 'toast', 'skeleton', 'spinner'],
  overlay: ['dialog', 'alert-dialog', 'sheet', 'popover', 'tooltip', 'hover-card'],
  core: ['button', 'card', 'input', 'label', 'badge'] // Most commonly used
};

export class ComponentGroupPrefetcher {
  constructor(
    private prefetchManager: SimplePrefetchManager,
    private framework: string
  ) {}
  
  async prefetchGroup(groupName: keyof typeof COMPONENT_GROUPS): Promise<void> {
    const components = COMPONENT_GROUPS[groupName];
    
    if (!components) {
      throw new Error(`Unknown component group: ${groupName}`);
    }
    
    const spinner = ora(`Prefetching ${groupName} components...`).start();
    
    try {
      const result = await this.prefetchManager.prefetchComponents(
        components,
        this.framework
      );
      
      spinner.succeed(
        `Prefetched ${result.success.length}/${components.length} ${groupName} components`
      );
      
      if (result.failed.length > 0) {
        console.log(chalk.yellow('Failed to prefetch:'), result.failed.join(', '));
      }
    } catch (error) {
      spinner.fail(`Failed to prefetch ${groupName} components`);
      throw error;
    }
  }
  
  async prefetchPopular(limit: number = 10): Promise<void> {
    const popular = this.prefetchManager.getPopularComponents(this.framework, limit);
    
    if (popular.length === 0) {
      console.log(chalk.yellow('No popular components found yet'));
      return;
    }
    
    await this.prefetchManager.prefetchComponents(popular, this.framework);
  }
}
```

### CLI Integration
```typescript
// Add simple prefetch commands
export async function prefetchCommand(
  options: {
    framework?: string;
    components?: string[];
    group?: string;
    popular?: boolean;
  }
): Promise<void> {
  const framework = options.framework || 'react';
  const prefetchManager = new SimplePrefetchManager(
    getStorage(),
    {
      enabled: true,
      maxConcurrent: 3,
      popularThreshold: 5,
      relatedComponents: new Map()
    }
  );
  
  const groupPrefetcher = new ComponentGroupPrefetcher(prefetchManager, framework);
  
  if (options.components) {
    // Prefetch specific components
    const result = await prefetchManager.prefetchComponents(
      options.components,
      framework
    );
    
    console.log(chalk.green(`✓ Prefetched ${result.success.length} components`));
    if (result.failed.length > 0) {
      console.log(chalk.red(`✗ Failed: ${result.failed.join(', ')}`));
    }
    
  } else if (options.group) {
    // Prefetch a group
    await groupPrefetcher.prefetchGroup(options.group as any);
    
  } else if (options.popular) {
    // Prefetch popular components
    await groupPrefetcher.prefetchPopular();
    
  } else {
    // Default: prefetch core components
    await groupPrefetcher.prefetchGroup('core');
  }
}
```

### Configuration
```typescript
// Simple configuration for prefetching
export const prefetchConfigSchema = z.object({
  prefetch: z.object({
    enabled: z.boolean().default(true),
    maxConcurrent: z.number().min(1).max(5).default(3),
    popularThreshold: z.number().min(1).default(5),
    autoRelated: z.boolean().default(true),
    groups: z.object({
      onStartup: z.array(z.string()).default(['core']),
      onIdle: z.array(z.string()).default([])
    })
  })
});
```

## Acceptance Criteria
- [ ] Basic prefetching works for related components
- [ ] Popular component tracking accurate
- [ ] Component groups can be prefetched
- [ ] Manual prefetch commands work
- [ ] Prefetch queue processes efficiently
- [ ] No performance impact on main operations
- [ ] Configuration controls prefetch behavior

## Testing Requirements
- Unit tests for SimplePrefetchManager
- Usage tracking accuracy tests
- Component group prefetch tests
- Queue processing tests
- Concurrent prefetch limit tests

## Estimated Effort
- 4-6 hours

## Dependencies
- Existing storage-integration.ts
- CLI infrastructure
- Component relationship definitions

## Notes
- Keep it simple - no ML or complex predictions
- Focus on static relationships and manual control
- Monitor actual usage to refine component groups
- Consider adding prefetch hints to component metadata