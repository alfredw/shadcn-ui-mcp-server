/**
 * Default configuration source - provides base configuration values
 */

import { ConfigSource, CacheConfiguration } from '../schemas.js';

export class DefaultConfigSource implements ConfigSource {
  readonly name = 'DefaultConfigSource';
  readonly priority = 1; // Lowest priority - base configuration
  
  async load(): Promise<CacheConfiguration> {
    return {
      storage: {
        type: 'hybrid',
        memory: {
          enabled: true,
          maxSize: 50 * 1024 * 1024, // 50MB
          ttl: 3600, // 1 hour
          evictionPolicy: 'lru'
        },
        pglite: {
          enabled: true,
          maxSize: 200 * 1024 * 1024, // 200MB - larger than memory
          enableWAL: true,
          busyTimeout: 5000,
          vacuumInterval: 24
        },
        github: {
          enabled: true,
          baseUrl: 'https://api.github.com',
          timeout: 30000,
          retries: 3
        }
      },
      cache: {
        strategy: 'read-through',
        ttl: {
          components: 7 * 24 * 60 * 60, // 7 days
          blocks: 7 * 24 * 60 * 60, // 7 days
          metadata: 60 * 60 // 1 hour
        },
        prefetch: {
          enabled: true,
          popular: true,
          related: false
        },
        compression: {
          enabled: false,
          algorithm: 'gzip',
          level: 6
        }
      },
      performance: {
        batchSize: 100,
        concurrency: 10,
        queueSize: 1000,
        flushInterval: 5000
      },
      monitoring: {
        enabled: true,
        statsInterval: 5000,
        metricsRetention: 30,
        exporters: {
          prometheus: false,
          json: true
        },
        alerts: []
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: false,
        experimentalFeatures: []
      }
    };
  }
}