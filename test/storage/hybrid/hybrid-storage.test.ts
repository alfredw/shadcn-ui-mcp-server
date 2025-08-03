/**
 * Hybrid Storage Provider Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { expect } from 'vitest';
import { 
  HybridStorageProvider, 
  CacheStrategy 
} from '../../../build/storage/index.js';

describe('HybridStorageProvider', () => {
  let hybridStorage: HybridStorageProvider;
  
  beforeEach(async () => {
    // Create hybrid storage with memory and mock providers for testing
    hybridStorage = new HybridStorageProvider({
      memory: {
        enabled: true,
        maxSize: 1024 * 1024, // 1MB
        ttl: 300 // 5 minutes
      },
      pglite: {
        enabled: false // Disable for unit tests to avoid database setup
      },
      github: {
        enabled: false // Disable for unit tests to avoid API calls
      },
      strategy: CacheStrategy.READ_THROUGH,
      debug: false
    });
  });
  
  afterEach(async () => {
    if (hybridStorage && !hybridStorage.isDisposed()) {
      await hybridStorage.dispose();
    }
  });
  
  describe('Configuration', () => {
    it('should initialize with default configuration', () => {
      const storage = new HybridStorageProvider();
      const config = storage.getHybridConfig();
      
      expect(config.strategy).toBe(CacheStrategy.READ_THROUGH);
      expect(config.memory.enabled).toBe(true);
      expect(config.pglite.enabled).toBe(true);
      expect(config.github.enabled).toBe(true);
    });
    
    it('should merge custom configuration with defaults', () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.WRITE_THROUGH,
        memory: { maxSize: 2048 },
        circuitBreaker: { threshold: 10 }
      });
      
      const config = storage.getHybridConfig();
      
      expect(config.strategy).toBe(CacheStrategy.WRITE_THROUGH);
      expect(config.memory.maxSize).toBe(2048);
      expect(config.memory.ttl).toBe(3600); // Default value preserved
      expect(config.circuitBreaker.threshold).toBe(10);
    });
  });
  
  describe('Basic Operations', () => {
    it('should store and retrieve values', async () => {
      const key = 'test:key';
      const value = { data: 'test value' };
      
      await hybridStorage.set(key, value);
      const retrieved = await hybridStorage.get(key);
      
      expect(retrieved).toEqual(value);
    });
    
    it('should return undefined for non-existent keys', async () => {
      const result = await hybridStorage.get('non:existent');
      expect(result).toBeUndefined();
    });
    
    it('should check key existence', async () => {
      const key = 'exists:test';
      const value = { test: true };
      
      expect(await hybridStorage.has(key)).toBe(false);
      
      await hybridStorage.set(key, value);
      expect(await hybridStorage.has(key)).toBe(true);
    });
    
    it('should delete keys', async () => {
      const key = 'delete:test';
      const value = { data: 'to be deleted' };
      
      await hybridStorage.set(key, value);
      expect(await hybridStorage.has(key)).toBe(true);
      
      const deleted = await hybridStorage.delete(key);
      expect(deleted).toBe(true);
      expect(await hybridStorage.has(key)).toBe(false);
    });
    
    it('should clear all data', async () => {
      await hybridStorage.set('key1', 'value1');
      await hybridStorage.set('key2', 'value2');
      
      expect(await hybridStorage.size()).toBeGreaterThan(0);
      
      await hybridStorage.clear();
      expect(await hybridStorage.size()).toBe(0);
    });
  });
  
  describe('Batch Operations', () => {
    it('should handle batch get operations', async () => {
      const data = new Map([
        ['batch:key1', { value: 1 }],
        ['batch:key2', { value: 2 }],
        ['batch:key3', { value: 3 }]
      ]);
      
      await hybridStorage.mset(data);
      
      const keys = Array.from(data.keys());
      const results = await hybridStorage.mget(keys);
      
      expect(results.size).toBe(3);
      expect(results.get('batch:key1')).toEqual({ value: 1 });
      expect(results.get('batch:key2')).toEqual({ value: 2 });
      expect(results.get('batch:key3')).toEqual({ value: 3 });
    });
    
    it('should handle partial batch results', async () => {
      await hybridStorage.set('exists:1', 'value1');
      
      const keys = ['exists:1', 'missing:1', 'missing:2'];
      const results = await hybridStorage.mget(keys);
      
      expect(results.size).toBe(1);
      expect(results.get('exists:1')).toBe('value1');
      expect(results.has('missing:1')).toBe(false);
      expect(results.has('missing:2')).toBe(false);
    });
    
    it('should handle batch set operations', async () => {
      const data = new Map([
        ['mset:1', 'value1'],
        ['mset:2', 'value2'],
        ['mset:3', 'value3']
      ]);
      
      await hybridStorage.mset(data);
      
      for (const [key, value] of data) {
        expect(await hybridStorage.get(key)).toBe(value);
      }
    });
  });
  
  describe('Cache Strategies', () => {
    it('should handle READ_THROUGH strategy', async () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.READ_THROUGH,
        memory: { enabled: true },
        pglite: { enabled: false },
        github: { enabled: false }
      });
      
      await storage.set('strategy:read_through', 'test');
      const value = await storage.get('strategy:read_through');
      
      expect(value).toBe('test');
      await storage.dispose();
    });
    
    it('should handle WRITE_THROUGH strategy', async () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.WRITE_THROUGH,
        memory: { enabled: true },
        pglite: { enabled: false },
        github: { enabled: false }
      });
      
      await storage.set('strategy:write_through', 'test');
      const value = await storage.get('strategy:write_through');
      
      expect(value).toBe('test');
      await storage.dispose();
    });
    
    it('should handle WRITE_BEHIND strategy', async () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.WRITE_BEHIND,
        memory: { enabled: true },
        pglite: { enabled: false },
        github: { enabled: false }
      });
      
      await storage.set('strategy:write_behind', 'test');
      
      // Should be immediately available from L1 cache
      const value = await storage.get('strategy:write_behind');
      expect(value).toBe('test');
      
      await storage.dispose();
    });
    
    it('should handle CACHE_ASIDE strategy', async () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.CACHE_ASIDE,
        memory: { enabled: true },
        pglite: { enabled: false },
        github: { enabled: false }
      });
      
      await storage.set('strategy:cache_aside', 'test');
      const value = await storage.get('strategy:cache_aside');
      
      expect(value).toBe('test');
      await storage.dispose();
    });
  });
  
  describe('Statistics', () => {
    it('should track cache statistics', async () => {
      // Set some data
      await hybridStorage.set('stats:1', 'value1');
      await hybridStorage.set('stats:2', 'value2');
      
      // Access data (should be hits)
      await hybridStorage.get('stats:1');
      await hybridStorage.get('stats:2');
      
      // Try to access non-existent data (should be miss)
      await hybridStorage.get('stats:missing');
      
      const stats = hybridStorage.getStats();
      
      expect(stats.totalOperations).toBeGreaterThan(0);
      expect(stats.hits.memory).toBe(2); // Two hits from memory
      expect(stats.misses).toBe(1); // One miss
      expect(stats.hitRate).toBeGreaterThan(0);
    });
    
    it('should calculate hit rates correctly', async () => {
      // Create a scenario with known hit/miss ratio
      await hybridStorage.set('hit:1', 'value');
      await hybridStorage.set('hit:2', 'value');
      
      // 2 hits
      await hybridStorage.get('hit:1');
      await hybridStorage.get('hit:2');
      
      // 1 miss
      await hybridStorage.get('miss:1');
      
      const stats = hybridStorage.getStats();
      
      // Hit rate should be 2/(2+1) = 66.67%
      expect(Math.abs(stats.hitRate - 66.67)).toBeLessThan(0.1);
    });
  });
  
  describe('Key Pattern Matching', () => {
    it('should list all keys', async () => {
      await hybridStorage.set('pattern:test:1', 'value1');
      await hybridStorage.set('pattern:test:2', 'value2');
      await hybridStorage.set('other:key', 'value3');
      
      const allKeys = await hybridStorage.keys();
      
      expect(allKeys).toContain('pattern:test:1');
      expect(allKeys).toContain('pattern:test:2');
      expect(allKeys).toContain('other:key');
      expect(allKeys).toHaveLength(3);
    });
    
    it('should filter keys by pattern', async () => {
      await hybridStorage.set('component:react:button', 'button');
      await hybridStorage.set('component:react:card', 'card');
      await hybridStorage.set('block:react:dashboard', 'dashboard');
      
      const componentKeys = await hybridStorage.keys('component:*');
      
      expect(componentKeys).toContain('component:react:button');
      expect(componentKeys).toContain('component:react:card');
      expect(componentKeys).not.toContain('block:react:dashboard');
    });
  });
  
  describe('Metadata Operations', () => {
    it('should retrieve metadata for stored items', async () => {
      const key = 'metadata:test';
      const value = { test: 'data' };
      
      await hybridStorage.set(key, value);
      const metadata = await hybridStorage.getMetadata(key);
      
      expect(metadata).not.toBeNull();
      expect(metadata!.key).toBe(key);
      expect(metadata!.size).toBeGreaterThan(0);
      expect(metadata!.createdAt).toBeInstanceOf(Date);
      expect(metadata!.updatedAt).toBeInstanceOf(Date);
    });
    
    it('should return null for non-existent metadata', async () => {
      const metadata = await hybridStorage.getMetadata('non:existent');
      expect(metadata).toBeNull();
    });
  });
  
  describe('Error Handling', () => {
    it('should handle invalid keys gracefully', async () => {
      await expect(hybridStorage.get('')).rejects.toThrow();
      await expect(hybridStorage.set('', 'value')).rejects.toThrow();
    });
    
    it('should handle disposal correctly', async () => {
      await hybridStorage.set('dispose:test', 'value');
      
      await hybridStorage.dispose();
      expect(hybridStorage.isDisposed()).toBe(true);
      
      // Operations after disposal should throw
      await expect(hybridStorage.get('dispose:test')).rejects.toThrow();
      await expect(hybridStorage.set('new:key', 'value')).rejects.toThrow();
    });
  });
  
  describe('Circuit Breaker', () => {
    it('should provide circuit breaker status', () => {
      const status = hybridStorage.getCircuitBreakerStatus();
      
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('failureCount');
      expect(status).toHaveProperty('isRequestAllowed');
    });
    
    it('should allow manual circuit breaker control', () => {
      // Initially should be closed
      let status = hybridStorage.getCircuitBreakerStatus();
      expect(status.isRequestAllowed).toBe(true);
      
      // Open manually
      hybridStorage.openCircuitBreaker();
      status = hybridStorage.getCircuitBreakerStatus();
      expect(status.isRequestAllowed).toBe(false);
      
      // Close manually
      hybridStorage.closeCircuitBreaker();
      status = hybridStorage.getCircuitBreakerStatus();
      expect(status.isRequestAllowed).toBe(true);
    });
  });
  
  describe('Size Tracking', () => {
    it('should track storage size', async () => {
      expect(await hybridStorage.size()).toBe(0);
      
      await hybridStorage.set('size:1', 'value1');
      expect(await hybridStorage.size()).toBe(1);
      
      await hybridStorage.set('size:2', 'value2');
      expect(await hybridStorage.size()).toBe(2);
      
      await hybridStorage.delete('size:1');
      expect(await hybridStorage.size()).toBe(1);
    });
  });
  
  describe('Concurrent Operations', () => {
    it('should handle concurrent reads', async () => {
      const key = 'concurrent:read';
      const value = 'test value';
      
      await hybridStorage.set(key, value);
      
      // Perform multiple concurrent reads
      const promises = Array.from({ length: 10 }, () => hybridStorage.get(key));
      const results = await Promise.all(promises);
      
      // All reads should return the same value
      results.forEach(result => {
        expect(result).toBe(value);
      });
    });
    
    it('should handle concurrent writes', async () => {
      const baseKey = 'concurrent:write';
      
      // Perform multiple concurrent writes
      const promises = Array.from({ length: 10 }, (_, i) => 
        hybridStorage.set(`${baseKey}:${i}`, `value${i}`)
      );
      
      await Promise.all(promises);
      
      // Verify all writes succeeded
      for (let i = 0; i < 10; i++) {
        const value = await hybridStorage.get(`${baseKey}:${i}`);
        expect(value).toBe(`value${i}`);
      }
    });
    
    it('should handle mixed concurrent operations', async () => {
      const key = 'concurrent:mixed';
      
      // Start with initial data
      await hybridStorage.set(key, 'initial');
      
      // Mix of reads and writes
      const operations = [
        hybridStorage.get(key),
        hybridStorage.set(`${key}:1`, 'write1'),
        hybridStorage.get(key),
        hybridStorage.set(`${key}:2`, 'write2'),
        hybridStorage.has(key),
        hybridStorage.delete(`${key}:1`)
      ];
      
      const results = await Promise.allSettled(operations);
      
      // Check that operations completed (successfully or with expected failures)
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          // Log any unexpected failures for debugging
          console.warn(`Operation ${index} failed:`, result.reason);
        }
      });
      
      // The storage should still be functional
      expect(await hybridStorage.get(key)).toBe('initial');
      expect(await hybridStorage.get(`${key}:2`)).toBe('write2');
    });
  });
});

describe('HybridStorageProvider Integration', () => {
  it('should work with memory-only configuration', async () => {
    const storage = new HybridStorageProvider({
      memory: { enabled: true, maxSize: 1024 },
      pglite: { enabled: false },
      github: { enabled: false }
    });
    
    await storage.set('memory:test', 'value');
    const value = await storage.get('memory:test');
    
    expect(value).toBe('value');
    
    const stats = storage.getStats();
    expect(stats.tierAvailability.memory).toBe(true);
    expect(stats.tierAvailability.pglite).toBe(false);
    expect(stats.tierAvailability.github).toBe(false);
    
    await storage.dispose();
  });
});