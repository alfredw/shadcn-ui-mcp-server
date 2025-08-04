# Phase 2, Task 2: Smart Cache Invalidation

## Overview
Implement intelligent cache invalidation strategies that go beyond simple TTL expiration. This includes content-based invalidation, dependency tracking, and real-time updates through GitHub webhooks.

## Objectives
- Implement content-based cache invalidation
- Track component dependencies for cascade invalidation
- Add GitHub webhook support for real-time updates
- Create manual invalidation API with patterns
- Implement cache versioning for safe updates

## Technical Requirements

### Cache Invalidation Manager
```typescript
export interface InvalidationRule {
  pattern: string | RegExp;
  strategy: 'immediate' | 'lazy' | 'cascade';
  dependencies?: string[];
  version?: number;
}

export class CacheInvalidationManager {
  private rules: Map<string, InvalidationRule> = new Map();
  private dependencies: Map<string, Set<string>> = new Map();
  private versions: Map<string, number> = new Map();
  
  constructor(
    private storage: HybridStorage,
    private config: ConfigurationManager
  ) {
    this.loadInvalidationRules();
  }
  
  // Register invalidation rules
  registerRule(rule: InvalidationRule): void {
    const key = typeof rule.pattern === 'string' 
      ? rule.pattern 
      : rule.pattern.source;
      
    this.rules.set(key, rule);
    
    // Track dependencies
    if (rule.dependencies) {
      rule.dependencies.forEach(dep => {
        if (!this.dependencies.has(dep)) {
          this.dependencies.set(dep, new Set());
        }
        this.dependencies.get(dep)!.add(key);
      });
    }
  }
  
  // Invalidate cache entries
  async invalidate(
    pattern: string | RegExp,
    options: {
      cascade?: boolean;
      force?: boolean;
      reason?: string;
    } = {}
  ): Promise<InvalidationResult> {
    const startTime = Date.now();
    const invalidated: string[] = [];
    const errors: Array<{ key: string; error: Error }> = [];
    
    try {
      // Find matching keys
      const keys = await this.findMatchingKeys(pattern);
      
      // Invalidate each key
      for (const key of keys) {
        try {
          await this.invalidateKey(key, options);
          invalidated.push(key);
          
          // Handle cascade invalidation
          if (options.cascade) {
            const cascaded = await this.invalidateDependents(key, options);
            invalidated.push(...cascaded);
          }
        } catch (error) {
          errors.push({ key, error: error as Error });
        }
      }
      
      // Log invalidation event
      logger.info('Cache invalidation completed', {
        pattern: pattern.toString(),
        invalidated: invalidated.length,
        errors: errors.length,
        duration: Date.now() - startTime,
        reason: options.reason
      });
      
      return {
        success: errors.length === 0,
        invalidated,
        errors,
        duration: Date.now() - startTime
      };
      
    } catch (error) {
      logger.error('Cache invalidation failed', error);
      throw error;
    }
  }
  
  // Invalidate a specific key
  private async invalidateKey(
    key: string,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const rule = this.findRule(key);
    
    if (rule?.strategy === 'lazy' && !options.force) {
      // Mark as stale instead of deleting
      await this.markAsStale(key);
    } else {
      // Immediate invalidation
      await this.storage.delete(key);
    }
    
    // Update version
    this.incrementVersion(key);
  }
  
  // Find and invalidate dependent keys
  private async invalidateDependents(
    key: string,
    options: any
  ): Promise<string[]> {
    const dependents = this.dependencies.get(key);
    if (!dependents) return [];
    
    const invalidated: string[] = [];
    
    for (const dependent of dependents) {
      try {
        await this.invalidateKey(dependent, options);
        invalidated.push(dependent);
        
        // Recursive cascade
        if (options.cascade) {
          const cascaded = await this.invalidateDependents(dependent, options);
          invalidated.push(...cascaded);
        }
      } catch (error) {
        logger.error(`Failed to invalidate dependent ${dependent}`, error);
      }
    }
    
    return invalidated;
  }
  
  // Mark entry as stale without deleting
  private async markAsStale(key: string): Promise<void> {
    const data = await this.storage.get(key);
    if (data) {
      await this.storage.set(key, {
        ...data,
        _stale: true,
        _staleAt: Date.now()
      });
    }
  }
  
  // Version-based invalidation
  private incrementVersion(pattern: string): void {
    const current = this.versions.get(pattern) || 0;
    this.versions.set(pattern, current + 1);
  }
  
  getVersion(key: string): number {
    // Find the most specific version
    for (const [pattern, version] of this.versions) {
      if (this.matchesPattern(key, pattern)) {
        return version;
      }
    }
    return 0;
  }
  
  // Check if cache entry is valid based on version
  async isValid(key: string, cachedVersion?: number): Promise<boolean> {
    const currentVersion = this.getVersion(key);
    
    if (cachedVersion === undefined) {
      // No version info, check if stale
      const data = await this.storage.get(key);
      return data && !data._stale;
    }
    
    return cachedVersion >= currentVersion;
  }
}
```

### Dependency Tracking
```typescript
export class DependencyTracker {
  private graph: Map<string, Set<string>> = new Map();
  
  // Track component dependencies
  async analyzeComponent(
    componentName: string,
    sourceCode: string
  ): Promise<string[]> {
    const dependencies: Set<string> = new Set();
    
    // Parse imports
    const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(sourceCode)) !== null) {
      const importPath = match[1];
      
      // Check if it's a local component
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const resolvedComponent = this.resolveComponentPath(componentName, importPath);
        if (resolvedComponent) {
          dependencies.add(resolvedComponent);
        }
      }
    }
    
    // Store in graph
    this.graph.set(componentName, dependencies);
    
    return Array.from(dependencies);
  }
  
  // Get all components that depend on a given component
  getDependents(componentName: string): string[] {
    const dependents: Set<string> = new Set();
    
    for (const [component, deps] of this.graph) {
      if (deps.has(componentName)) {
        dependents.add(component);
      }
    }
    
    return Array.from(dependents);
  }
  
  // Get transitive dependencies
  getTransitiveDependencies(componentName: string): string[] {
    const visited = new Set<string>();
    const dependencies = new Set<string>();
    
    this.dfs(componentName, visited, dependencies);
    
    // Remove self
    dependencies.delete(componentName);
    
    return Array.from(dependencies);
  }
  
  private dfs(
    node: string,
    visited: Set<string>,
    result: Set<string>
  ): void {
    if (visited.has(node)) return;
    
    visited.add(node);
    result.add(node);
    
    const deps = this.graph.get(node) || new Set();
    for (const dep of deps) {
      this.dfs(dep, visited, result);
    }
  }
}
```

### GitHub Webhook Integration
```typescript
export interface WebhookPayload {
  action: 'created' | 'updated' | 'deleted';
  repository: string;
  ref: string;
  files: Array<{
    path: string;
    action: 'added' | 'modified' | 'removed';
  }>;
}

export class GitHubWebhookHandler {
  constructor(
    private invalidationManager: CacheInvalidationManager,
    private dependencyTracker: DependencyTracker
  ) {}
  
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    logger.info('Processing GitHub webhook', {
      action: payload.action,
      files: payload.files.length
    });
    
    const invalidationTasks: Promise<any>[] = [];
    
    for (const file of payload.files) {
      if (this.isComponentFile(file.path)) {
        const componentName = this.extractComponentName(file.path);
        
        // Invalidate the component itself
        invalidationTasks.push(
          this.invalidationManager.invalidate(
            `component:*:${componentName}`,
            {
              cascade: true,
              reason: `GitHub webhook: ${file.action}`
            }
          )
        );
        
        // Invalidate dependents
        const dependents = this.dependencyTracker.getDependents(componentName);
        for (const dependent of dependents) {
          invalidationTasks.push(
            this.invalidationManager.invalidate(
              `component:*:${dependent}`,
              {
                reason: `Dependency ${componentName} was ${file.action}`
              }
            )
          );
        }
      }
      
      // Handle other file types
      if (this.isBlockFile(file.path)) {
        const blockName = this.extractBlockName(file.path);
        invalidationTasks.push(
          this.invalidationManager.invalidate(
            `block:*:${blockName}*`,
            {
              reason: `GitHub webhook: ${file.action}`
            }
          )
        );
      }
    }
    
    // Execute all invalidations in parallel
    await Promise.all(invalidationTasks);
    
    // Invalidate lists if files were added/removed
    if (payload.files.some(f => f.action !== 'modified')) {
      await this.invalidationManager.invalidate(
        /^list:/,
        {
          reason: 'GitHub webhook: file structure changed'
        }
      );
    }
  }
  
  private isComponentFile(path: string): boolean {
    return path.includes('/ui/') && 
           (path.endsWith('.tsx') || path.endsWith('.svelte'));
  }
  
  private extractComponentName(path: string): string {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.(tsx|svelte)$/, '');
  }
}
```

### Manual Invalidation API
```typescript
// CLI command for cache invalidation
export async function invalidateCache(
  pattern: string,
  options: {
    cascade?: boolean;
    dryRun?: boolean;
    force?: boolean;
  }
): Promise<void> {
  const invalidationManager = new CacheInvalidationManager(
    getStorage(),
    getConfig()
  );
  
  if (options.dryRun) {
    // Show what would be invalidated
    const keys = await invalidationManager.findMatchingKeys(pattern);
    console.log(chalk.yellow('Dry run - would invalidate:'));
    keys.forEach(key => console.log(`  - ${key}`));
    
    if (options.cascade) {
      console.log(chalk.yellow('\nCascade invalidation would also affect:'));
      for (const key of keys) {
        const deps = invalidationManager.getDependents(key);
        deps.forEach(dep => console.log(`  - ${dep} (depends on ${key})`));
      }
    }
    
    return;
  }
  
  // Perform invalidation
  const spinner = ora('Invalidating cache entries...').start();
  
  try {
    const result = await invalidationManager.invalidate(pattern, {
      cascade: options.cascade,
      force: options.force,
      reason: 'Manual CLI invalidation'
    });
    
    spinner.succeed(
      `Invalidated ${result.invalidated.length} entries in ${result.duration}ms`
    );
    
    if (result.errors.length > 0) {
      console.log(chalk.red('\nErrors:'));
      result.errors.forEach(({ key, error }) => {
        console.log(`  - ${key}: ${error.message}`);
      });
    }
    
  } catch (error) {
    spinner.fail('Invalidation failed');
    throw error;
  }
}
```

### Smart Invalidation Rules
```typescript
// Pre-configured invalidation rules
export const defaultInvalidationRules: InvalidationRule[] = [
  {
    // Invalidate component demos when component changes
    pattern: /^component:(.+):(.+)$/,
    strategy: 'cascade',
    dependencies: ['component-demo:$1:$2']
  },
  {
    // Invalidate lists when items change
    pattern: /^(component|block):(.+):(.+)$/,
    strategy: 'lazy',
    dependencies: ['list:$1s:$2']
  },
  {
    // Invalidate metadata when GitHub rate limit changes
    pattern: 'metadata:github_rate_limit',
    strategy: 'immediate',
    dependencies: []
  }
];

// Content-based invalidation
export class ContentBasedInvalidator {
  async shouldInvalidate(
    key: string,
    oldContent: any,
    newContent: any
  ): Promise<boolean> {
    // Skip if content is identical
    if (JSON.stringify(oldContent) === JSON.stringify(newContent)) {
      return false;
    }
    
    // Component-specific checks
    if (key.startsWith('component:')) {
      return this.hasSignificantComponentChange(oldContent, newContent);
    }
    
    // Default: invalidate on any change
    return true;
  }
  
  private hasSignificantComponentChange(
    oldComponent: any,
    newComponent: any
  ): boolean {
    // Check for API changes
    if (oldComponent.props !== newComponent.props) {
      return true;
    }
    
    // Check for dependency changes
    const oldDeps = new Set(oldComponent.dependencies || []);
    const newDeps = new Set(newComponent.dependencies || []);
    
    if (oldDeps.size !== newDeps.size) {
      return true;
    }
    
    for (const dep of newDeps) {
      if (!oldDeps.has(dep)) {
        return true;
      }
    }
    
    // Check for significant code changes (not just whitespace)
    const oldCode = oldComponent.sourceCode.replace(/\s+/g, '');
    const newCode = newComponent.sourceCode.replace(/\s+/g, '');
    
    return oldCode !== newCode;
  }
}
```

## Acceptance Criteria
- [ ] Pattern-based cache invalidation works correctly
- [ ] Dependency tracking accurately identifies relationships
- [ ] Cascade invalidation follows dependency graph
- [ ] GitHub webhooks trigger appropriate invalidations
- [ ] Version-based invalidation prevents stale data
- [ ] Lazy invalidation marks entries as stale
- [ ] Manual invalidation CLI command works
- [ ] Content-based invalidation reduces unnecessary updates

## Testing Requirements
- Unit tests for InvalidationManager
- Dependency graph traversal tests
- Webhook payload processing tests
- Pattern matching tests
- Version tracking tests
- Integration tests with real cache
- Performance tests for large-scale invalidation

## Estimated Effort
- 10-12 hours

## Dependencies
- Hybrid storage system
- CLI infrastructure
- GitHub webhook endpoint setup

## Notes
- Consider implementing cache warming after invalidation
- Add metrics for invalidation frequency
- Future: GraphQL subscription support
- Monitor webhook processing performance