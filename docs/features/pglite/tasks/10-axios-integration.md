# Task 10: Update Axios Implementations to Use Hybrid Storage

## Overview
Integrate the hybrid storage system into the existing axios implementations (axios.ts and axios-svelte.ts). This task involves refactoring the current direct GitHub API calls to use the hybrid storage layer, ensuring backward compatibility while adding caching benefits.

## Objectives
- Replace direct cache usage with hybrid storage
- Maintain existing API contracts
- Add storage event instrumentation
- Implement proper error handling
- Ensure framework-specific logic remains intact
- Add request deduplication

## Technical Requirements

### Current Implementation Analysis
```typescript
// Current axios.ts structure
export const axiosInstance = axios.create({
  baseURL: GITHUB_API_BASE_URL,
  headers: {
    'Accept': 'application/vnd.github.v3+json',
    ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
  }
});

// Current caching approach
const cache = new Map<string, CacheEntry>();

export async function fetchFileContent(path: string): Promise<string> {
  const cacheKey = `file:${path}`;
  
  if (cache.has(cacheKey)) {
    const entry = cache.get(cacheKey)!;
    if (Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data;
    }
  }
  
  const response = await axiosInstance.get(`/repos/${REPO}/contents/${path}`);
  const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
  
  cache.set(cacheKey, { data: content, timestamp: Date.now() });
  
  return content;
}
```

### Refactored Implementation
```typescript
// Updated axios.ts with hybrid storage
import { HybridStorage } from '../storage/hybrid/hybrid-storage';
import { ConfigurationManager } from '../config/manager';
import { StatisticsCollector } from '../monitoring/collector';

export class GitHubClient {
  private storage: HybridStorage;
  private stats: StatisticsCollector;
  private requestDeduplicator: RequestDeduplicator;
  
  constructor(
    private config: ConfigurationManager,
    private framework: 'react' | 'svelte'
  ) {
    this.storage = new HybridStorage(config.get('storage'));
    this.stats = new StatisticsCollector(config.get('monitoring'));
    this.requestDeduplicator = new RequestDeduplicator();
    
    this.setupAxiosInterceptors();
  }
  
  private setupAxiosInterceptors() {
    // Request interceptor for rate limit handling
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        const rateLimit = await this.storage.get('metadata:github_rate_limit');
        
        if (rateLimit && rateLimit.remaining < 10) {
          this.logger.warn('GitHub rate limit low:', rateLimit);
          
          // Check if we can serve from cache instead
          const cacheKey = this.buildCacheKey(config);
          if (await this.storage.has(cacheKey)) {
            throw new CacheServeError(cacheKey);
          }
        }
        
        return config;
      }
    );
    
    // Response interceptor for caching
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // Store rate limit info
        this.updateRateLimitInfo(response.headers);
        return response;
      }
    );
  }
  
  async fetchFileContent(path: string): Promise<string> {
    const cacheKey = `file:${this.framework}:${path}`;
    const startTime = Date.now();
    
    try {
      // Check storage first
      const cached = await this.storage.get(cacheKey);
      if (cached) {
        this.stats.recordEvent({
          type: 'hit',
          tier: 'hybrid',
          framework: this.framework,
          resourceType: 'file',
          responseTime: Date.now() - startTime
        });
        
        return cached;
      }
      
      // Deduplicate concurrent requests
      return await this.requestDeduplicator.deduplicate(cacheKey, async () => {
        // Fetch from GitHub
        const response = await this.axiosInstance.get(
          `/repos/${this.getRepo()}/contents/${path}`
        );
        
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        
        // Store in hybrid storage
        await this.storage.set(cacheKey, content, this.config.get('cache.ttl.files'));
        
        this.stats.recordEvent({
          type: 'miss',
          tier: 'github',
          framework: this.framework,
          resourceType: 'file',
          responseTime: Date.now() - startTime,
          bytesServed: content.length
        });
        
        return content;
      });
      
    } catch (error) {
      if (error instanceof CacheServeError) {
        // Served from cache due to rate limit
        return await this.storage.get(error.cacheKey);
      }
      
      this.stats.recordEvent({
        type: 'error',
        tier: 'github',
        framework: this.framework,
        resourceType: 'file',
        responseTime: Date.now() - startTime,
        error
      });
      
      throw error;
    }
  }
  
  async fetchComponentData(componentName: string): Promise<ComponentData> {
    const cacheKey = `component:${this.framework}:${componentName}`;
    
    // Try hybrid storage first
    const cached = await this.storage.get(cacheKey);
    if (cached) return cached;
    
    // Fetch component files
    const [sourceCode, demoCode] = await Promise.all([
      this.fetchFileContent(`${this.getComponentPath()}/${componentName}.tsx`),
      this.fetchDemoContent(componentName)
    ]);
    
    // Parse metadata
    const metadata = this.parseComponentMetadata(sourceCode);
    
    const componentData: ComponentData = {
      framework: this.framework,
      name: componentName,
      sourceCode,
      demoCode,
      metadata,
      dependencies: metadata.dependencies || [],
      registryDependencies: metadata.registryDependencies || []
    };
    
    // Store in hybrid storage
    await this.storage.set(
      cacheKey, 
      componentData,
      this.config.get('cache.ttl.components')
    );
    
    return componentData;
  }
  
  private getRepo(): string {
    return this.framework === 'svelte' 
      ? 'huntabyte/shadcn-svelte'
      : 'shadcn-ui/ui';
  }
  
  private getComponentPath(): string {
    return this.framework === 'svelte'
      ? 'apps/www/src/lib/registry/default/ui'
      : 'apps/www/registry/default/ui';
  }
}
```

### Request Deduplication
```typescript
class RequestDeduplicator {
  private inFlightRequests = new Map<string, Promise<any>>();
  
  async deduplicate<T>(key: string, factory: () => Promise<T>): Promise<T> {
    // Check if request is already in flight
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }
    
    // Create new request
    const promise = factory()
      .finally(() => {
        // Clean up after completion
        this.inFlightRequests.delete(key);
      });
    
    this.inFlightRequests.set(key, promise);
    
    return promise;
  }
}
```

### Component Registry Integration
```typescript
// Update registry fetching
export class ComponentRegistry {
  constructor(private client: GitHubClient) {}
  
  async listComponents(): Promise<ComponentMetadata[]> {
    const cacheKey = `registry:${this.client.framework}:components`;
    
    // Check cache first
    const cached = await this.client.storage.get(cacheKey);
    if (cached) return cached;
    
    // Fetch registry index
    const indexPath = this.client.framework === 'svelte'
      ? 'apps/www/src/lib/registry/index.ts'
      : 'apps/www/registry/index.tsx';
    
    const indexContent = await this.client.fetchFileContent(indexPath);
    const components = this.parseRegistryIndex(indexContent);
    
    // Store in cache with shorter TTL for lists
    await this.client.storage.set(
      cacheKey,
      components,
      this.client.config.get('cache.ttl.metadata')
    );
    
    return components;
  }
  
  async getComponent(name: string): Promise<Component> {
    const components = await this.listComponents();
    const metadata = components.find(c => c.name === name);
    
    if (!metadata) {
      throw new Error(`Component ${name} not found`);
    }
    
    const data = await this.client.fetchComponentData(name);
    
    return {
      ...metadata,
      ...data
    };
  }
}
```

### Migration Path
```typescript
// Backward compatibility wrapper
export function createAxiosInstance(options?: AxiosOptions): AxiosInstance {
  const config = new ConfigurationManager();
  const framework = options?.framework || 'react';
  
  const client = new GitHubClient(config, framework);
  
  // Return axios instance with interceptors
  return client.axiosInstance;
}

// Gradual migration approach
export class AxiosMigrationAdapter {
  private legacyCache = new Map<string, any>();
  private hybridStorage: HybridStorage;
  
  constructor() {
    // Initialize hybrid storage
    this.hybridStorage = new HybridStorage(defaultConfig);
    
    // Migrate existing cache entries
    this.migrateExistingCache();
  }
  
  private async migrateExistingCache() {
    for (const [key, value] of this.legacyCache) {
      try {
        await this.hybridStorage.set(key, value.data);
      } catch (error) {
        console.error(`Failed to migrate cache key ${key}:`, error);
      }
    }
  }
  
  // Adapter methods that use hybrid storage
  async get(key: string): Promise<any> {
    // Try hybrid storage first
    const value = await this.hybridStorage.get(key);
    if (value) return value;
    
    // Fallback to legacy cache
    if (this.legacyCache.has(key)) {
      const entry = this.legacyCache.get(key)!;
      if (Date.now() - entry.timestamp < CACHE_TTL) {
        // Migrate to hybrid storage
        await this.hybridStorage.set(key, entry.data);
        return entry.data;
      }
    }
    
    return null;
  }
}
```

### Event Instrumentation
```typescript
// Storage events for monitoring
export class InstrumentedHybridStorage extends HybridStorage {
  async get(key: string): Promise<any> {
    const startTime = Date.now();
    const tier = await this.determineTier(key);
    
    try {
      const result = await super.get(key);
      
      this.emit('storage:access', {
        operation: 'get',
        key,
        tier,
        hit: result !== undefined,
        responseTime: Date.now() - startTime
      });
      
      return result;
      
    } catch (error) {
      this.emit('storage:error', {
        operation: 'get',
        key,
        tier,
        error,
        responseTime: Date.now() - startTime
      });
      
      throw error;
    }
  }
  
  private async determineTier(key: string): Promise<string> {
    if (await this.providers.memory?.has(key)) return 'memory';
    if (await this.providers.pglite?.has(key)) return 'pglite';
    return 'github';
  }
}
```

### Framework-Specific Updates

#### React (axios.ts)
```typescript
export async function fetchReactComponent(name: string): Promise<Component> {
  const client = new GitHubClient(configManager, 'react');
  const registry = new ComponentRegistry(client);
  
  return registry.getComponent(name);
}
```

#### Svelte (axios-svelte.ts)
```typescript
export async function fetchSvelteComponent(name: string): Promise<Component> {
  const client = new GitHubClient(configManager, 'svelte');
  const registry = new ComponentRegistry(client);
  
  // Svelte-specific processing
  const component = await registry.getComponent(name);
  
  // Transform imports for Svelte
  component.sourceCode = transformSvelteImports(component.sourceCode);
  
  return component;
}
```

### Implementation Details

1. **Directory Structure Updates**:
   ```
   src/utils/
   ├── axios.ts (updated)
   ├── axios-svelte.ts (updated)
   ├── github-client.ts (new)
   ├── component-registry.ts (new)
   └── request-deduplicator.ts (new)
   ```

2. **Incremental Rollout**:
   - Feature flag for new implementation
   - A/B testing capability
   - Rollback mechanism

3. **Performance Optimizations**:
   - Connection pooling
   - HTTP/2 support
   - Request batching

### Acceptance Criteria
- [ ] All existing axios functionality works with hybrid storage
- [ ] No breaking changes to external API
- [ ] Request deduplication prevents duplicate API calls
- [ ] Storage events properly instrumented
- [ ] Framework-specific logic preserved
- [ ] Performance meets or exceeds current implementation
- [ ] Migration path for existing cache entries

### Testing Requirements
- Unit tests for GitHub client
- Integration tests with hybrid storage
- Framework-specific tests
- Request deduplication tests
- Performance comparison tests
- Migration tests

### Dependencies
- All previous tasks (1-9)
- Existing axios implementation

### Estimated Effort
- 3-4 days

### Example Usage
```typescript
// Before (direct axios usage)
const content = await fetchFileContent('button.tsx');

// After (same API, hybrid storage underneath)
const content = await fetchFileContent('button.tsx');

// New capabilities
const client = new GitHubClient(config, 'react');

// Batch fetch with deduplication
const components = await Promise.all([
  client.fetchComponentData('button'),
  client.fetchComponentData('card'),
  client.fetchComponentData('dialog')
]);

// Check cache status
const stats = await client.getCacheStats();
console.log(`Cache hit rate: ${stats.hitRate}%`);

// Force refresh
await client.refresh('component:react:button');

// Offline mode
config.set('features.offlineMode', true);
const offlineComponent = await client.fetchComponentData('button');
```

### Notes
- Monitor GitHub API usage after deployment
- Consider implementing prefetching for popular components
- Add WebSocket support for real-time cache updates
- Document migration guide for consumers