/**
 * Configuration Profiles Tests
 * Tests the intent and behavior of configuration profiles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigurationProfiles } from '../../src/config/profiles.js';
import { CacheConfiguration } from '../../src/config/schemas.js';

describe('ConfigurationProfiles', () => {
  let profiles: ConfigurationProfiles;
  let baseConfig: CacheConfiguration;
  
  beforeEach(() => {
    profiles = new ConfigurationProfiles();
    
    // Create a base configuration for testing
    baseConfig = {
      storage: {
        type: 'hybrid',
        memory: {
          enabled: true,
          maxSize: 50 * 1024 * 1024,
          ttl: 3600,
          evictionPolicy: 'lru'
        },
        pglite: {
          enabled: true,
          maxSize: 100 * 1024 * 1024,
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
          components: 7 * 24 * 60 * 60,
          blocks: 7 * 24 * 60 * 60,
          metadata: 60 * 60
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
        resetTimeout: 30000
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: false,
        experimentalFeatures: []
      }
    };
  });

  describe('Profile Discovery Intent', () => {
    it('should provide list of available profiles', () => {
      const profileNames = profiles.getProfileNames();
      
      // Intent: Should include standard profiles
      expect(profileNames).toContain('development');
      expect(profileNames).toContain('production');
      expect(profileNames).toContain('offline');
      expect(profileNames).toContain('testing');
      expect(profileNames).toContain('performance');
      expect(profileNames).toContain('low-resource');
      
      // Intent: Should return array of strings
      expect(Array.isArray(profileNames)).toBe(true);
      expect(profileNames.every(name => typeof name === 'string')).toBe(true);
    });

    it('should check if profile exists', () => {
      // Intent: Should correctly identify existing profiles
      expect(profiles.hasProfile('development')).toBe(true);
      expect(profiles.hasProfile('production')).toBe(true);
      expect(profiles.hasProfile('nonexistent')).toBe(false);
    });

    it('should provide profile descriptions', () => {
      // Intent: Should provide meaningful descriptions
      const devDescription = profiles.getProfileDescription('development');
      const prodDescription = profiles.getProfileDescription('production');
      
      expect(devDescription).toContain('development');
      expect(prodDescription).toContain('production');
      expect(typeof devDescription).toBe('string');
      expect(typeof prodDescription).toBe('string');
    });
  });

  describe('Development Profile Intent', () => {
    it('should configure for local development needs', () => {
      const result = profiles.applyProfile('development', baseConfig);
      
      // Intent: Should use memory-only for faster iteration
      expect(result.storage.type).toBe('memory-only');
      
      // Intent: Should have larger memory for development
      expect(result.storage.memory?.maxSize).toBe(200 * 1024 * 1024);
      
      // Intent: Should enable all experimental features
      expect(result.features.experimentalFeatures).toEqual(['*']);
      
      // Intent: Should disable analytics in dev
      expect(result.features.analytics).toBe(false);
      
      // Intent: Should have more frequent stats for debugging
      expect(result.monitoring.statsInterval).toBe(2000);
    });
  });

  describe('Production Profile Intent', () => {
    it('should configure for production workloads', () => {
      const result = profiles.applyProfile('production', baseConfig);
      
      // Intent: Should use hybrid storage for production
      expect(result.storage.type).toBe('hybrid');
      
      // Intent: Should enable compression for efficiency
      expect(result.cache?.compression?.enabled).toBe(true);
      
      // Intent: Should enable Prometheus for monitoring
      expect(result.monitoring?.exporters?.prometheus).toBe(true);
      
      // Intent: Should have longer TTL for stability
      expect(result.cache?.ttl?.components).toBe(14 * 24 * 60 * 60);
      
      // Intent: Should disable experimental features
      expect(result.features?.experimentalFeatures).toEqual([]);
      
      // Intent: Should enable analytics
      expect(result.features?.analytics).toBe(true);
    });
  });

  describe('Offline Profile Intent', () => {
    it('should configure for disconnected environments', () => {
      const result = profiles.applyProfile('offline', baseConfig);
      
      // Intent: Should use PGLite-only (no GitHub API)
      expect(result.storage.type).toBe('pglite-only');
      
      // Intent: Should disable GitHub API
      expect(result.storage?.github?.enabled).toBe(false);
      
      // Intent: Should enable offline mode
      expect(result.features?.offlineMode).toBe(true);
      
      // Intent: Should disable auto-sync
      expect(result.features?.autoSync).toBe(false);
      
      // Intent: Should have much longer TTL for offline use
      expect(result.cache?.ttl?.components).toBe(30 * 24 * 60 * 60);
      
      // Intent: Should disable circuit breaker
      expect(result.circuitBreaker?.enabled).toBe(false);
    });
  });

  describe('Testing Profile Intent', () => {
    it('should configure for automated testing', () => {
      const result = profiles.applyProfile('testing', baseConfig);
      
      // Intent: Should use memory-only for test isolation
      expect(result.storage.type).toBe('memory-only');
      
      // Intent: Should have small memory footprint
      expect(result.storage?.memory?.maxSize).toBe(10 * 1024 * 1024);
      
      // Intent: Should have very short TTL for test isolation
      expect(result.storage?.memory?.ttl).toBe(60);
      
      // Intent: Should disable monitoring
      expect(result.monitoring?.enabled).toBe(false);
      
      // Intent: Should disable analytics and migration
      expect(result.features?.analytics).toBe(false);
      expect(result.features?.migration).toBe(false);
      
      // Intent: Should have low concurrency for predictable tests
      expect(result.performance?.concurrency).toBe(2);
    });
  });

  describe('Performance Profile Intent', () => {
    it('should configure for high-throughput scenarios', () => {
      const result = profiles.applyProfile('performance', baseConfig);
      
      // Intent: Should use write-behind for async performance
      expect(result.cache?.strategy).toBe('write-behind');
      
      // Intent: Should have large batch sizes
      expect(result.performance?.batchSize).toBe(500);
      
      // Intent: Should have high concurrency
      expect(result.performance?.concurrency).toBe(50);
      
      // Intent: Should disable WAL for write performance
      expect(result.storage?.pglite?.enableWAL).toBe(false);
      
      // Intent: Should use fastest compression
      expect(result.cache?.compression?.level).toBe(1);
    });
  });

  describe('Low-Resource Profile Intent', () => {
    it('should configure for resource-constrained environments', () => {
      const result = profiles.applyProfile('low-resource', baseConfig);
      
      // Intent: Should use PGLite-only to save memory
      expect(result.storage.type).toBe('pglite-only');
      
      // Intent: Should have very small storage limits
      expect(result.storage?.pglite?.maxSize).toBe(20 * 1024 * 1024);
      
      // Intent: Should have very low concurrency
      expect(result.performance?.concurrency).toBe(2);
      
      // Intent: Should disable monitoring to save resources
      expect(result.monitoring?.enabled).toBe(false);
      
      // Intent: Should use maximum compression to save space
      expect(result.cache?.compression?.level).toBe(9);
    });
  });

  describe('Profile Management Intent', () => {
    it('should allow registering custom profiles', () => {
      const customProfile = {
        storage: {
          type: 'memory-only' as const
        },
        features: {
          customFeature: true
        }
      };
      
      profiles.registerProfile('custom', customProfile);
      
      // Intent: Should be able to retrieve custom profile
      expect(profiles.hasProfile('custom')).toBe(true);
      expect(profiles.getProfile('custom')).toEqual(customProfile);
    });

    it('should allow removing profiles', () => {
      // Intent: Should be able to remove profiles
      expect(profiles.removeProfile('development')).toBe(true);
      expect(profiles.hasProfile('development')).toBe(false);
      
      // Intent: Should return false for non-existent profiles
      expect(profiles.removeProfile('nonexistent')).toBe(false);
    });
  });

  describe('Profile Application Intent', () => {
    it('should merge profile with base configuration correctly', () => {
      const result = profiles.applyProfile('development', baseConfig);
      
      // Intent: Profile values should override base config
      expect(result.storage.type).toBe('memory-only'); // From profile
      
      // Intent: Unspecified values should remain from base config
      expect(result.storage.github?.baseUrl).toBe('https://api.github.com');
      expect(result.circuitBreaker.threshold).toBe(5);
    });

    it('should throw error for unknown profiles', () => {
      // Intent: Should throw meaningful error for unknown profile
      expect(() => {
        profiles.applyProfile('nonexistent', baseConfig);
      }).toThrow(/Unknown profile.*nonexistent/);
    });

    it('should preserve nested object structure', () => {
      // Setup: Profile that modifies nested objects
      profiles.registerProfile('nested-test', {
        cache: {
          compression: {
            enabled: true,
            level: 3
          }
        }
      });
      
      const result = profiles.applyProfile('nested-test', baseConfig);
      
      // Intent: Should merge nested objects correctly
      expect(result.cache.compression.enabled).toBe(true);
      expect(result.cache.compression.level).toBe(3);
      expect(result.cache.compression.algorithm).toBe('gzip'); // From base
      
      // Intent: Should preserve unrelated nested objects
      expect(result.cache.ttl.components).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('Profile Consistency Intent', () => {
    it('should ensure all profiles produce valid configurations', () => {
      const profileNames = profiles.getProfileNames();
      
      // Intent: All profiles should be applicable to base config
      profileNames.forEach(profileName => {
        expect(() => {
          profiles.applyProfile(profileName, baseConfig);
        }).not.toThrow();
      });
    });

    it('should ensure profile descriptions exist for all profiles', () => {
      const profileNames = profiles.getProfileNames();
      
      // Intent: All profiles should have descriptions
      profileNames.forEach(profileName => {
        const description = profiles.getProfileDescription(profileName);
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(0);
      });
    });
  });
});