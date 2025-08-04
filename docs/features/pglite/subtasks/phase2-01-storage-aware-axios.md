# Phase 2, Task 1: Storage-Aware Axios Wrapper

## Overview
Create a storage-aware wrapper around the existing axios implementations that deeply integrates caching at the HTTP client level. This will provide more control over caching behavior and enable advanced features like partial responses and conditional requests.

## Objectives
- Create StorageAwareAxios class that wraps existing axios instances
- Add storage parameter to axios functions for optional caching control
- Implement HTTP-style caching headers support
- Maintain complete backward compatibility
- Enable fine-grained cache control per request

## Technical Requirements

### StorageAwareAxios Implementation
```typescript
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { HybridStorage } from '../storage/hybrid/hybrid-storage';
import { ConfigurationManager } from '../config/manager';

export interface StorageAwareConfig extends AxiosRequestConfig {
  storage?: {
    enabled?: boolean;
    ttl?: number;
    key?: string;
    strategy?: 'cache-first' | 'network-first' | 'cache-only' | 'network-only';
    staleWhileRevalidate?: boolean;
    validateCache?: (cached: any) => boolean;
  };
}

export class StorageAwareAxios {
  private storage: HybridStorage;
  private config: ConfigurationManager;
  
  constructor(
    private axiosInstance: AxiosInstance,
    private framework: 'react' | 'svelte'
  ) {
    this.config = new ConfigurationManager();
    this.storage = new HybridStorage(this.config.get('storage'));
    
    this.setupInterceptors();
  }
  
  private setupInterceptors(): void {
    // Request interceptor for cache checking
    this.axiosInstance.interceptors.request.use(
      async (config: StorageAwareConfig) => {
        if (!this.shouldUseCache(config)) {
          return config;
        }
        
        const cacheKey = this.getCacheKey(config);
        const strategy = config.storage?.strategy || 'cache-first';
        
        // Handle cache-only strategy
        if (strategy === 'cache-only') {
          const cached = await this.storage.get(cacheKey);
          if (cached) {
            // Short-circuit the request by rejecting with cached data
            throw new CacheHitError(cached);
          }
        }
        
        // Handle cache-first strategy
        if (strategy === 'cache-first') {
          const cached = await this.storage.get(cacheKey);
          if (cached && this.isValid(cached, config)) {
            // Add cache info to config for response interceptor
            config.headers = {
              ...config.headers,
              'X-Cache-Hit': 'true',
              'X-Cache-Key': cacheKey
            };
            
            // Short-circuit with cached data
            throw new CacheHitError(cached);
          }
        }
        
        // Add cache key to config for response interceptor
        config.headers = {
          ...config.headers,
          'X-Cache-Key': cacheKey
        };
        
        return config;
      },
      error => Promise.reject(error)
    );
    
    // Response interceptor for cache storage
    this.axiosInstance.interceptors.response.use(
      async (response: AxiosResponse) => {
        const config = response.config as StorageAwareConfig;
        
        if (!this.shouldUseCache(config)) {
          return response;
        }
        
        const cacheKey = config.headers?.['X-Cache-Key'];
        if (!cacheKey) return response;
        
        // Extract TTL from response headers or config
        const ttl = this.extractTTL(response, config);
        
        // Store in cache
        await this.storage.set(cacheKey, response.data, ttl);
        
        // Handle stale-while-revalidate
        if (config.storage?.staleWhileRevalidate) {
          this.revalidateInBackground(config, cacheKey);
        }
        
        return response;
      },
      async error => {
        // Handle cache hits (not really errors)
        if (error instanceof CacheHitError) {
          return {
            data: error.data,
            status: 200,
            statusText: 'OK (from cache)',
            headers: { 'x-cache': 'HIT' },
            config: error.config
          };
        }
        
        // Handle network errors with cache fallback
        const config = error.config as StorageAwareConfig;
        if (config && this.shouldUseCache(config)) {
          const cacheKey = config.headers?.['X-Cache-Key'];
          if (cacheKey) {
            const cached = await this.storage.get(cacheKey);
            if (cached) {
              console.warn('Network error, serving stale cache:', error.message);
              return {
                data: cached,
                status: 200,
                statusText: 'OK (stale cache)',
                headers: { 'x-cache': 'STALE' },
                config
              };
            }
          }
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  private shouldUseCache(config: StorageAwareConfig): boolean {
    // Skip caching for non-GET requests by default
    if (config.method && config.method.toUpperCase() !== 'GET') {
      return false;
    }
    
    // Check if storage is explicitly disabled
    if (config.storage?.enabled === false) {
      return false;
    }
    
    // Check global configuration
    if (!this.config.get('features.caching')) {
      return false;
    }
    
    return true;
  }
  
  private getCacheKey(config: StorageAwareConfig): string {
    // Use provided key or generate from request
    if (config.storage?.key) {
      return config.storage.key;
    }
    
    // Generate key from URL and params
    const url = config.url || '';
    const params = config.params ? JSON.stringify(config.params) : '';
    
    return `http:${this.framework}:${url}:${params}`;
  }
  
  private isValid(cached: any, config: StorageAwareConfig): boolean {
    // Custom validation function
    if (config.storage?.validateCache) {
      return config.storage.validateCache(cached);
    }
    
    // Default: cache is valid if it exists
    return cached !== undefined && cached !== null;
  }
  
  private extractTTL(response: AxiosResponse, config: StorageAwareConfig): number {
    // Priority: config > cache-control header > default
    if (config.storage?.ttl) {
      return config.storage.ttl;
    }
    
    // Parse Cache-Control header
    const cacheControl = response.headers['cache-control'];
    if (cacheControl) {
      const maxAge = this.parseCacheControl(cacheControl);
      if (maxAge) {
        return maxAge * 1000; // Convert to milliseconds
      }
    }
    
    // Default TTL based on content type
    const contentType = response.config.url || '';
    if (contentType.includes('/contents/')) {
      return this.config.get('cache.ttl.files');
    } else if (contentType.includes('/git/trees/')) {
      return this.config.get('cache.ttl.metadata');
    }
    
    return this.config.get('cache.ttl.default');
  }
  
  private parseCacheControl(header: string): number | null {
    const match = header.match(/max-age=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
  
  private async revalidateInBackground(
    config: StorageAwareConfig, 
    cacheKey: string
  ): Promise<void> {
    // Perform background revalidation
    setTimeout(async () => {
      try {
        // Force network request
        const networkConfig = {
          ...config,
          storage: { ...config.storage, strategy: 'network-only' }
        };
        
        await this.axiosInstance.request(networkConfig);
      } catch (error) {
        console.error('Background revalidation failed:', error);
      }
    }, 0);
  }
  
  // Proxy all axios methods with storage awareness
  get<T = any>(url: string, config?: StorageAwareConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.get(url, config);
  }
  
  post<T = any>(url: string, data?: any, config?: StorageAwareConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.post(url, data, config);
  }
  
  // ... other HTTP methods ...
}

class CacheHitError extends Error {
  constructor(public data: any, public config?: AxiosRequestConfig) {
    super('Cache hit');
    this.name = 'CacheHitError';
  }
}
```

### Integration with Existing Axios
```typescript
// Update axios.ts and axios-svelte.ts
export function createStorageAwareAxios(
  framework: 'react' | 'svelte'
): StorageAwareAxios {
  const baseInstance = framework === 'react' ? githubApi : githubApiSvelte;
  return new StorageAwareAxios(baseInstance, framework);
}

// Backward compatible wrapper
export async function getComponentSource(
  componentName: string,
  options?: { useCache?: boolean; ttl?: number }
): Promise<string> {
  const storageAxios = createStorageAwareAxios(getFramework());
  
  const response = await storageAxios.get(
    `/repos/${REPO}/contents/${paths.components}/${componentName}${FILE_EXTENSION}`,
    {
      storage: {
        enabled: options?.useCache !== false,
        ttl: options?.ttl,
        key: `component:${getFramework()}:${componentName}`,
        strategy: 'cache-first'
      }
    }
  );
  
  return Buffer.from(response.data.content, 'base64').toString('utf-8');
}
```

### Advanced Caching Features
```typescript
// Conditional requests with ETags
export class ConditionalRequestHandler {
  private etagStore = new Map<string, string>();
  
  async makeConditionalRequest(
    axios: StorageAwareAxios,
    url: string,
    cacheKey: string
  ): Promise<any> {
    const etag = this.etagStore.get(cacheKey);
    
    try {
      const response = await axios.get(url, {
        headers: etag ? { 'If-None-Match': etag } : {},
        storage: {
          key: cacheKey,
          strategy: 'network-first'
        }
      });
      
      // Store new ETag
      if (response.headers.etag) {
        this.etagStore.set(cacheKey, response.headers.etag);
      }
      
      return response.data;
      
    } catch (error: any) {
      // Handle 304 Not Modified
      if (error.response?.status === 304) {
        // Serve from cache
        const cached = await this.storage.get(cacheKey);
        if (cached) return cached;
      }
      
      throw error;
    }
  }
}

// Partial response caching
export class PartialResponseCache {
  async cachePartialResponse(
    key: string,
    offset: number,
    length: number,
    data: any
  ): Promise<void> {
    const partialKey = `${key}:partial:${offset}:${length}`;
    await this.storage.set(partialKey, data);
  }
  
  async getPartialResponse(
    key: string,
    offset: number,
    length: number
  ): Promise<any | null> {
    const partialKey = `${key}:partial:${offset}:${length}`;
    return this.storage.get(partialKey);
  }
}
```

### Configuration Integration
```typescript
// Add storage-aware axios configuration
export const axiosStorageConfigSchema = z.object({
  axios: z.object({
    cache: z.object({
      enabled: z.boolean().default(true),
      defaultStrategy: z.enum(['cache-first', 'network-first', 'cache-only', 'network-only'])
        .default('cache-first'),
      staleWhileRevalidate: z.boolean().default(false),
      respectCacheHeaders: z.boolean().default(true),
      maxStaleAge: z.number().default(86400000) // 24 hours
    })
  })
});
```

## Acceptance Criteria
- [ ] StorageAwareAxios wraps existing axios instances
- [ ] All caching strategies work correctly
- [ ] HTTP cache headers are respected
- [ ] Stale-while-revalidate pattern implemented
- [ ] Network errors fall back to stale cache
- [ ] Complete backward compatibility maintained
- [ ] Configuration options control cache behavior
- [ ] ETag/conditional request support works

## Testing Requirements
- Unit tests for StorageAwareAxios class
- Integration tests with real GitHub API
- Cache strategy tests (all 4 strategies)
- Network failure fallback tests
- Concurrent request handling tests
- Performance comparison tests
- Header parsing tests

## Estimated Effort
- 8-10 hours

## Dependencies
- Existing axios implementations
- Hybrid storage system
- Configuration management

## Notes
- Consider implementing request coalescing
- Add support for range requests in future
- Monitor memory usage of ETag store
- Consider browser Cache API compatibility