/**
 * Configuration profiles for different environments and use cases
 */

import { CacheConfiguration } from './schemas.js';

export class ConfigurationProfiles {
  private profiles: Map<string, Partial<CacheConfiguration>> = new Map([
    // Development profile - optimized for local development
    ['development', {
      storage: {
        type: 'memory-only',
        memory: { 
          enabled: true,
          maxSize: 200 * 1024 * 1024, // 200MB for dev
          ttl: 1800, // 30 minutes - shorter for faster iteration
          evictionPolicy: 'lru' as const
        }
      },
      monitoring: { 
        enabled: true,
        statsInterval: 2000, // More frequent stats in dev
        metricsRetention: 7, // Keep metrics for 7 days in dev
        exporters: {
          prometheus: false,
          json: true
        },
        alerts: [] // No alerts in dev
      },
      features: { 
        offlineMode: false,
        migration: true,
        analytics: false, // Disable analytics in dev
        autoSync: true,
        experimentalFeatures: ['*'] // Enable all experimental features
      },
      performance: {
        batchSize: 50, // Smaller batches for debugging
        concurrency: 5, // Lower concurrency for easier debugging
        queueSize: 200, // Default queue size
        flushInterval: 5000 // Default flush interval
      },
      cache: {
        strategy: 'cache-aside',
        compression: {
          enabled: false, // Disable compression in dev for speed
          algorithm: 'gzip',
          level: 1
        },
        ttl: {
          components: 60 * 60, // 1 hour in dev
          blocks: 60 * 60,     // 1 hour
          metadata: 30 * 60    // 30 minutes
        },
        prefetch: {
          enabled: false, // Disable prefetch in dev for predictability
          popular: false,
          related: false
        }
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      }
    }],
    
    // Production profile - optimized for production workloads
    ['production', {
      storage: {
        type: 'hybrid',
        memory: { 
          enabled: true,
          maxSize: 50 * 1024 * 1024, // 50MB L1 cache
          ttl: 3600, // 1 hour
          evictionPolicy: 'lru' as const
        },
        pglite: { 
          enabled: true,
          maxSize: 500 * 1024 * 1024, // 500MB L2 cache
          enableWAL: true,
          vacuumInterval: 12, // More frequent vacuum in prod
          busyTimeout: 30000,
          path: '.shadcn-mcp/cache.db'
        }
      },
      cache: { 
        strategy: 'read-through',
        compression: { 
          enabled: true,
          algorithm: 'gzip',
          level: 6 
        },
        ttl: {
          components: 14 * 24 * 60 * 60, // 14 days - longer in prod
          blocks: 14 * 24 * 60 * 60,     // 14 days
          metadata: 4 * 60 * 60          // 4 hours
        },
        prefetch: {
          enabled: true,
          popular: true,
          related: true
        }
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      },
      monitoring: { 
        enabled: true,
        statsInterval: 30000, // 30 seconds in prod
        exporters: { 
          prometheus: true,
          json: true 
        },
        metricsRetention: 90, // 90 days retention in prod
        alerts: [] // Configure alerts as needed
      },
      performance: {
        batchSize: 200, // Larger batches for efficiency
        concurrency: 20, // Higher concurrency for throughput
        queueSize: 2000, // Larger queue
        flushInterval: 5000 // 5 seconds in production
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: true,
        experimentalFeatures: [] // No experimental features in prod
      }
    }],
    
    // Offline profile - optimized for disconnected environments
    ['offline', {
      storage: {
        type: 'pglite-only',
        pglite: {
          enabled: true,
          maxSize: 1024 * 1024 * 1024, // 1GB - larger local storage
          enableWAL: true,
          path: '.shadcn-mcp/cache.db',
          busyTimeout: 30000,
          vacuumInterval: 24
        },
        github: { 
          enabled: false, // Disable GitHub API calls
          baseUrl: 'https://api.github.com',
          timeout: 30000,
          retries: 3
        }
      },
      features: { 
        offlineMode: true,
        migration: false, // Disable migration in offline mode
        analytics: false,
        autoSync: false, // Disable auto-sync in offline mode
        experimentalFeatures: []
      },
      cache: {
        strategy: 'cache-aside', // Suitable for offline mode
        ttl: {
          components: 30 * 24 * 60 * 60, // 30 days - much longer offline
          blocks: 30 * 24 * 60 * 60,     // 30 days
          metadata: 7 * 24 * 60 * 60     // 7 days
        },
        prefetch: {
          enabled: false, // Disable prefetch in offline mode
          popular: false,
          related: false
        },
        compression: {
          enabled: true,
          algorithm: 'gzip',
          level: 6
        }
      },
      circuitBreaker: {
        enabled: false, // Disable circuit breaker for offline mode
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      }
    }],
    
    // Testing profile - optimized for automated testing
    ['testing', {
      storage: {
        type: 'memory-only',
        memory: {
          enabled: true,
          maxSize: 10 * 1024 * 1024, // Small memory footprint for tests
          ttl: 60, // Very short TTL for test isolation
          evictionPolicy: 'lru' as const
        }
      },
      monitoring: {
        enabled: false, // Disable monitoring in tests
        statsInterval: 60000,
        metricsRetention: 1,
        exporters: {
          prometheus: false,
          json: false
        },
        alerts: []
      },
      features: {
        offlineMode: false,
        migration: false, // Disable migration in tests
        analytics: false,
        autoSync: false,
        experimentalFeatures: []
      },
      performance: {
        batchSize: 10,
        concurrency: 2,
        queueSize: 50,
        flushInterval: 100 // Fast flush for test speed
      },
      cache: {
        strategy: 'cache-aside',
        compression: {
          enabled: false, // Disable compression in tests
          algorithm: 'gzip',
          level: 1
        },
        ttl: {
          components: 60, // 1 minute in tests
          blocks: 60,     // 1 minute
          metadata: 30    // 30 seconds
        },
        prefetch: {
          enabled: false, // Disable prefetch in tests
          popular: false,
          related: false
        }
      },
      circuitBreaker: {
        enabled: false, // Disable in tests
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      }
    }],
    
    // Performance profile - optimized for high-throughput scenarios
    ['performance', {
      storage: {
        type: 'hybrid',
        memory: {
          enabled: true,
          maxSize: 100 * 1024 * 1024, // Larger memory cache
          ttl: 7200, // 2 hours
          evictionPolicy: 'lru' as const
        },
        pglite: {
          enabled: true,
          maxSize: 2 * 1024 * 1024 * 1024, // 2GB persistent cache
          enableWAL: false, // Disable WAL for better write performance
          busyTimeout: 1000, // Shorter timeout for performance
          path: '.shadcn-mcp/cache.db',
          vacuumInterval: 24
        }
      },
      cache: {
        strategy: 'write-behind', // Async writes for better performance
        compression: {
          enabled: true,
          algorithm: 'gzip',
          level: 1 // Fastest compression
        },
        ttl: {
          components: 7 * 24 * 60 * 60, // 7 days
          blocks: 7 * 24 * 60 * 60,     // 7 days
          metadata: 2 * 60 * 60         // 2 hours
        },
        prefetch: {
          enabled: true,
          popular: true,
          related: false // Disable related prefetch for performance
        }
      },
      circuitBreaker: {
        enabled: true,
        threshold: 10, // Higher threshold for performance
        timeout: 30000, // Shorter timeout for performance
        resetTimeout: 30000
      },
      performance: {
        batchSize: 500, // Large batches
        concurrency: 50, // High concurrency
        queueSize: 5000, // Large queue
        flushInterval: 1000 // Frequent flushes
      },
      monitoring: {
        enabled: true,
        statsInterval: 15000, // 15 seconds for performance monitoring
        metricsRetention: 30,
        exporters: {
          prometheus: true,
          json: true
        },
        alerts: []
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: true,
        experimentalFeatures: []
      }
    }],
    
    // Low-resource profile - optimized for resource-constrained environments
    ['low-resource', {
      storage: {
        type: 'pglite-only',
        pglite: {
          enabled: true,
          maxSize: 20 * 1024 * 1024, // 20MB only
          enableWAL: false,
          vacuumInterval: 48, // Less frequent vacuum
          path: '.shadcn-mcp/cache.db',
          busyTimeout: 30000
        }
      },
      performance: {
        batchSize: 25,
        concurrency: 2, // Very low concurrency
        queueSize: 100,
        flushInterval: 10000 // Infrequent flushes
      },
      monitoring: {
        enabled: false, // Disable to save resources
        statsInterval: 60000,
        metricsRetention: 1,
        exporters: {
          prometheus: false,
          json: false
        },
        alerts: []
      },
      cache: {
        strategy: 'cache-aside',
        compression: {
          enabled: true,
          algorithm: 'gzip',
          level: 9 // Maximum compression to save space
        },
        ttl: {
          components: 7 * 24 * 60 * 60, // 7 days
          blocks: 7 * 24 * 60 * 60,     // 7 days
          metadata: 24 * 60 * 60        // 24 hours
        },
        prefetch: {
          enabled: false, // Disable to save resources
          popular: false,
          related: false
        }
      },
      features: {
        offlineMode: false,
        migration: false, // Disable to save resources
        analytics: false,
        autoSync: false,
        experimentalFeatures: []
      }
    }]
  ]);
  
  /**
   * Get available profile names
   */
  getProfileNames(): string[] {
    return Array.from(this.profiles.keys());
  }
  
  /**
   * Get a configuration profile by name
   */
  getProfile(name: string): Partial<CacheConfiguration> | undefined {
    return this.profiles.get(name);
  }
  
  /**
   * Check if a profile exists
   */
  hasProfile(name: string): boolean {
    return this.profiles.has(name);
  }
  
  /**
   * Apply a profile to a base configuration
   */
  applyProfile(name: string, baseConfig: CacheConfiguration): CacheConfiguration {
    const profile = this.getProfile(name);
    if (!profile) {
      throw new Error(`Unknown profile: ${name}`);
    }
    
    return this.deepMerge(baseConfig, profile) as CacheConfiguration;
  }
  
  /**
   * Register a custom profile
   */
  registerProfile(name: string, profile: Partial<CacheConfiguration>): void {
    this.profiles.set(name, profile);
  }
  
  /**
   * Remove a profile
   */
  removeProfile(name: string): boolean {
    return this.profiles.delete(name);
  }
  
  /**
   * Get profile description for documentation
   */
  getProfileDescription(name: string): string {
    const descriptions: Record<string, string> = {
      'development': 'Optimized for local development with faster iteration cycles',
      'production': 'Optimized for production workloads with compression and monitoring',
      'offline': 'Optimized for disconnected environments with extended local storage',
      'testing': 'Optimized for automated testing with minimal resource usage',
      'performance': 'Optimized for high-throughput scenarios with async operations',
      'low-resource': 'Optimized for resource-constrained environments'
    };
    
    return descriptions[name] || 'Custom profile';
  }
  
  /**
   * Deep merge configuration objects
   */
  private deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) {
      return target;
    }
    
    if (typeof source !== 'object' || Array.isArray(source)) {
      return source;
    }
    
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && 
            source[key] !== null && 
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' && 
            target[key] !== null && 
            !Array.isArray(target[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }
}