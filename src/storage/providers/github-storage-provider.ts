import { StorageMetadata, StorageProvider, StorageProviderConfig } from '../interfaces/storage-provider.js';
import { BaseStorageProvider } from './base-storage-provider.js';
import { axios } from '../../utils/axios.js';

/**
 * Configuration specific to GitHub storage provider
 */
export interface GitHubStorageProviderConfig extends StorageProviderConfig {
  /**
   * GitHub API token for higher rate limits
   */
  apiKey?: string;
  
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
  
  /**
   * Whether to enable caching of GitHub responses
   */
  enableCache?: boolean;
  
  /**
   * Cache TTL for GitHub responses
   */
  cacheTTL?: number;
}

/**
 * Parsed key structure for GitHub storage
 */
interface ParsedGitHubKey {
  type: 'component' | 'block' | 'metadata' | 'directory' | 'unknown';
  framework?: string;
  name?: string;
  subtype?: string;
}

/**
 * GitHub storage provider that serves as L3 source of truth
 * Integrates with existing axios GitHub API implementation
 */
export class GitHubStorageProvider extends BaseStorageProvider {
  private githubConfig: Required<GitHubStorageProviderConfig>;
  private cache: Map<string, { value: any; timestamp: number; ttl: number }>;
  
  constructor(config: GitHubStorageProviderConfig = {}) {
    super(config);
    
    this.githubConfig = {
      ...this.config,
      apiKey: config.apiKey || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '',
      timeout: config.timeout || 30000,
      enableCache: config.enableCache ?? true,
      cacheTTL: config.cacheTTL || 300 // 5 minutes
    };
    
    this.cache = new Map();
    
    // Set GitHub API key if provided
    if (this.githubConfig.apiKey) {
      axios.setGitHubApiKey(this.githubConfig.apiKey);
    }
  }
  
  /**
   * Parse a storage key to understand what GitHub resource it refers to
   */
  private parseKey(key: string): ParsedGitHubKey {
    const parts = key.split(':');
    
    if (parts.length >= 3) {
      const [type, framework, name, ...rest] = parts;
      
      if (type === 'component' && framework && name) {
        return { type: 'component', framework, name };
      }
      
      if (type === 'block' && framework && name) {
        return { type: 'block', framework, name };
      }
      
      if (type === 'metadata') {
        return { type: 'metadata', subtype: framework };
      }
    }
    
    if (parts.length === 2) {
      const [type, subtype] = parts;
      
      if (type === 'directory') {
        return { type: 'directory', subtype };
      }
    }
    
    return { type: 'unknown' };
  }
  
  /**
   * Get a cached value if it exists and hasn't expired
   */
  private getCached(key: string): any | null {
    if (!this.githubConfig.enableCache) {
      return null;
    }
    
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    
    const now = Date.now();
    if (cached.ttl > 0 && (now - cached.timestamp) > cached.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.value;
  }
  
  /**
   * Set a value in the cache
   */
  private setCached(key: string, value: any, ttl?: number): void {
    if (!this.githubConfig.enableCache) {
      return;
    }
    
    const effectiveTTL = ttl ?? this.githubConfig.cacheTTL;
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: effectiveTTL
    });
  }
  
  async get(key: string): Promise<any> {
    return this.wrapOperation(`get(${key})`, async () => {
      this.validateKey(key);
      
      // Check cache first
      const cached = this.getCached(key);
      if (cached !== null) {
        this.debug(`Cache hit for GitHub key: ${key}`);
        return cached;
      }
      
      const parsed = this.parseKey(key);
      let result: any;
      
      try {
        switch (parsed.type) {
          case 'component':
            if (!parsed.framework || !parsed.name) {
              throw new Error(`Invalid component key: ${key}`);
            }
            result = await this.getComponent(parsed.framework, parsed.name);
            break;
            
          case 'block':
            if (!parsed.framework || !parsed.name) {
              throw new Error(`Invalid block key: ${key}`);
            }
            result = await this.getBlock(parsed.framework, parsed.name);
            break;
            
          case 'metadata':
            result = await this.getMetadataInfo(parsed.subtype);
            break;
            
          case 'directory':
            result = await this.getDirectory(parsed.subtype);
            break;
            
          default:
            this.debug(`Unknown key type for GitHub: ${key}`);
            return undefined;
        }
        
        // Cache the result
        this.setCached(key, result);
        this.debug(`Retrieved from GitHub: ${key}`);
        return result;
        
      } catch (error: any) {
        this.debug(`Failed to retrieve from GitHub: ${key} - ${error.message}`);
        return undefined;
      }
    });
  }
  
  /**
   * Get component data from GitHub
   */
  private async getComponent(framework: string, name: string): Promise<any> {
    // Only support React framework for now (shadcn/ui)
    if (framework !== 'react') {
      throw new Error(`Unsupported framework: ${framework}`);
    }
    
    try {
      const [sourceCode, demo, metadata] = await Promise.allSettled([
        axios.getComponentSource(name),
        axios.getComponentDemo(name).catch(() => null), // Demo is optional
        axios.getComponentMetadata(name).catch(() => null) // Metadata is optional
      ]);
      
      const source = sourceCode.status === 'fulfilled' ? sourceCode.value : null;
      if (!source) {
        throw new Error(`Component ${name} not found`);
      }
      
      return {
        framework,
        name,
        sourceCode: source,
        demoCode: demo.status === 'fulfilled' ? demo.value : null,
        metadata: metadata.status === 'fulfilled' ? metadata.value : {},
        dependencies: metadata.status === 'fulfilled' && metadata.value?.dependencies ? metadata.value.dependencies : [],
        registryDependencies: metadata.status === 'fulfilled' && metadata.value?.registryDependencies ? metadata.value.registryDependencies : [],
        type: 'component',
        source: 'github'
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch component ${name}: ${error.message}`);
    }
  }
  
  /**
   * Get block data from GitHub
   */
  private async getBlock(framework: string, name: string): Promise<any> {
    // Only support React framework for now (shadcn/ui)
    if (framework !== 'react') {
      throw new Error(`Unsupported framework: ${framework}`);
    }
    
    try {
      const blockData = await axios.getBlockCode(name, true);
      
      return {
        framework,
        name,
        type: 'block',
        blockType: blockData.type,
        description: blockData.description,
        code: blockData.code || null,
        files: blockData.files || {},
        structure: blockData.structure || [],
        dependencies: blockData.dependencies || [],
        componentsUsed: blockData.componentsUsed || [],
        usage: blockData.usage || '',
        source: 'github'
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch block ${name}: ${error.message}`);
    }
  }
  
  /**
   * Get metadata information
   */
  private async getMetadataInfo(subtype?: string): Promise<any> {
    try {
      if (subtype === 'rate_limit') {
        return await axios.getGitHubRateLimit();
      }
      
      if (subtype === 'components') {
        const components = await axios.getAvailableComponents();
        return {
          type: 'component_list',
          components,
          count: components.length,
          source: 'github'
        };
      }
      
      if (subtype === 'blocks') {
        const blocks = await axios.getAvailableBlocks();
        return {
          type: 'block_list',
          ...blocks,
          source: 'github'
        };
      }
      
      return {
        type: 'metadata',
        subtype,
        message: 'Unknown metadata type',
        source: 'github'
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch metadata ${subtype}: ${error.message}`);
    }
  }
  
  /**
   * Get directory structure
   */
  private async getDirectory(path?: string): Promise<any> {
    try {
      const structure = await axios.buildDirectoryTree();
      return {
        type: 'directory',
        path: path || 'root',
        structure,
        source: 'github'
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch directory ${path}: ${error.message}`);
    }
  }
  
  async set(key: string, value: any, ttl?: number): Promise<void> {
    return this.wrapOperation(`set(${key})`, async () => {
      // GitHub is read-only for most operations
      // We can only cache values locally, not persist to GitHub
      this.setCached(key, value, ttl);
      this.debug(`Cached GitHub key: ${key}`);
    });
  }
  
  async has(key: string): Promise<boolean> {
    return this.wrapOperation(`has(${key})`, async () => {
      this.validateKey(key);
      
      // Check cache first
      if (this.getCached(key) !== null) {
        return true;
      }
      
      // For GitHub, we can't efficiently check existence without fetching
      // So we'll attempt a lightweight fetch
      try {
        const value = await this.get(key);
        return value !== undefined;
      } catch {
        return false;
      }
    });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.wrapOperation(`delete(${key})`, async () => {
      // GitHub is read-only, but we can remove from cache
      const hadCached = this.cache.has(key);
      this.cache.delete(key);
      this.debug(`Removed from GitHub cache: ${key}`);
      return hadCached;
    });
  }
  
  async clear(): Promise<void> {
    return this.wrapOperation('clear()', async () => {
      this.cache.clear();
      this.debug('Cleared GitHub cache');
    });
  }
  
  async mget(keys: string[]): Promise<Map<string, any>> {
    return this.wrapOperation(`mget([${keys.length} keys])`, async () => {
      const result = new Map<string, any>();
      
      // Process keys in parallel for better performance
      const promises = keys.map(async (key) => {
        try {
          const value = await this.get(key);
          if (value !== undefined) {
            result.set(key, value);
          }
        } catch (error) {
          this.debug(`Failed to get ${key} in batch: ${error}`);
        }
      });
      
      await Promise.allSettled(promises);
      return result;
    });
  }
  
  async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
    return this.wrapOperation(`mset([${entries.size} entries])`, async () => {
      // GitHub is read-only, but we can cache the entries
      for (const [key, value] of entries) {
        this.setCached(key, value, ttl);
      }
      this.debug(`Cached ${entries.size} GitHub entries`);
    });
  }
  
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    return this.wrapOperation(`getMetadata(${key})`, async () => {
      this.validateKey(key);
      
      const cached = this.cache.get(key);
      if (!cached) {
        return null;
      }
      
      const size = this.calculateSize(cached.value);
      const now = new Date();
      
      return {
        key,
        size,
        ttl: cached.ttl,
        createdAt: new Date(cached.timestamp),
        updatedAt: new Date(cached.timestamp),
        accessedAt: now,
        accessCount: 1 // GitHub doesn't track access count
      };
    });
  }
  
  async keys(pattern?: string): Promise<string[]> {
    return this.wrapOperation(`keys(${pattern ?? '*'})`, async () => {
      const allKeys = Array.from(this.cache.keys());
      return this.matchPattern(allKeys, pattern);
    });
  }
  
  async size(): Promise<number> {
    return this.wrapOperation('size()', async () => {
      return this.cache.size;
    });
  }
  
  /**
   * Clean up expired cache entries
   */
  async cleanup(): Promise<number> {
    return this.wrapOperation('cleanup()', async () => {
      if (!this.githubConfig.enableCache) {
        return 0;
      }
      
      const now = Date.now();
      let cleaned = 0;
      
      for (const [key, cached] of this.cache.entries()) {
        if (cached.ttl > 0 && (now - cached.timestamp) > cached.ttl * 1000) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        this.debug(`Cleaned up ${cleaned} expired GitHub cache entries`);
      }
      
      return cleaned;
    });
  }
  
  /**
   * Get GitHub-specific configuration
   */
  getGitHubConfig(): Required<GitHubStorageProviderConfig> {
    return { ...this.githubConfig };
  }
}