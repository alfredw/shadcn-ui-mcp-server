import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { 
  HybridStorageProvider, 
  CacheStrategy, 
  MemoryStorageProvider,
  PGLiteStorageProvider,
  GitHubStorageProvider
} from '../../../build/storage/index.js';

describe('HybridStorageProvider', () => {
  let hybridStorage;
  
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
      
      assert.strictEqual(config.strategy, CacheStrategy.READ_THROUGH);
      assert.strictEqual(config.memory.enabled, true);
      assert.strictEqual(config.pglite.enabled, true);
      assert.strictEqual(config.github.enabled, true);
    });
    
    it('should merge custom configuration with defaults', () => {
      const storage = new HybridStorageProvider({
        strategy: CacheStrategy.WRITE_THROUGH,
        memory: { maxSize: 2048 },
        circuitBreaker: { threshold: 10 }
      });
      
      const config = storage.getHybridConfig();
      
      assert.strictEqual(config.strategy, CacheStrategy.WRITE_THROUGH);
      assert.strictEqual(config.memory.maxSize, 2048);
      assert.strictEqual(config.memory.ttl, 3600); // Default value preserved
      assert.strictEqual(config.circuitBreaker.threshold, 10);
    });
  });
  
  describe('Basic Operations', () => {
    it('should store and retrieve values', async () => {
      const key = 'test:key';
      const value = { data: 'test value' };
      
      await hybridStorage.set(key, value);
      const retrieved = await hybridStorage.get(key);
      
      assert.deepStrictEqual(retrieved, value);
    });
    
    it('should return undefined for non-existent keys', async () => {
      const result = await hybridStorage.get('non:existent');
      assert.strictEqual(result, undefined);
    });
    
    it('should check key existence', async () => {
      const key = 'exists:test';
      const value = { test: true };
      
      assert.strictEqual(await hybridStorage.has(key), false);
      
      await hybridStorage.set(key, value);
      assert.strictEqual(await hybridStorage.has(key), true);
    });
    
    it('should delete keys', async () => {
      const key = 'delete:test';
      const value = { data: 'to be deleted' };
      
      await hybridStorage.set(key, value);
      assert.strictEqual(await hybridStorage.has(key), true);
      
      const deleted = await hybridStorage.delete(key);
      assert.strictEqual(deleted, true);
      assert.strictEqual(await hybridStorage.has(key), false);
    });
    
    it('should clear all data', async () => {
      await hybridStorage.set('key1', 'value1');
      await hybridStorage.set('key2', 'value2');
      
      assert.ok((await hybridStorage.size()) > 0);
      
      await hybridStorage.clear();
      assert.strictEqual(await hybridStorage.size(), 0);
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
      
      assert.strictEqual(results.size, 3);
      assert.deepStrictEqual(results.get('batch:key1'), { value: 1 });
      assert.deepStrictEqual(results.get('batch:key2'), { value: 2 });
      assert.deepStrictEqual(results.get('batch:key3'), { value: 3 });
    });
    
    it('should handle partial batch results', async () => {
      await hybridStorage.set('exists:1', 'value1');
      
      const keys = ['exists:1', 'missing:1', 'missing:2'];
      const results = await hybridStorage.mget(keys);
      
      assert.strictEqual(results.size, 1);
      assert.strictEqual(results.get('exists:1'), 'value1');
      assert.strictEqual(results.has('missing:1'), false);
      assert.strictEqual(results.has('missing:2'), false);
    });
    
    it('should handle batch set operations', async () => {
      const data = new Map([
        ['mset:1', 'value1'],
        ['mset:2', 'value2'],
        ['mset:3', 'value3']
      ]);
      
      await hybridStorage.mset(data);
      
      for (const [key, value] of data) {
        assert.strictEqual(await hybridStorage.get(key), value);
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
      
      assert.strictEqual(value, 'test');
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
      
      assert.strictEqual(value, 'test');
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
      assert.strictEqual(value, 'test');
      
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
      
      assert.strictEqual(value, 'test');
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
      
      assert.ok(stats.totalOperations > 0);
      assert.strictEqual(stats.hits.memory, 2); // Two hits from memory
      assert.strictEqual(stats.misses, 1); // One miss
      assert.ok(stats.hitRate > 0);
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
      assert.ok(Math.abs(stats.hitRate - 66.67) < 0.1);
    });
  });
  
  describe('Key Pattern Matching', () => {
    it('should list all keys', async () => {
      await hybridStorage.set('pattern:test:1', 'value1');
      await hybridStorage.set('pattern:test:2', 'value2');
      await hybridStorage.set('other:key', 'value3');
      
      const allKeys = await hybridStorage.keys();
      
      assert.ok(allKeys.includes('pattern:test:1'));
      assert.ok(allKeys.includes('pattern:test:2'));
      assert.ok(allKeys.includes('other:key'));
      assert.strictEqual(allKeys.length, 3);
    });
    
    it('should filter keys by pattern', async () => {
      await hybridStorage.set('component:react:button', 'button');
      await hybridStorage.set('component:react:card', 'card');
      await hybridStorage.set('block:react:dashboard', 'dashboard');
      
      const componentKeys = await hybridStorage.keys('component:*');
      
      assert.ok(componentKeys.includes('component:react:button'));
      assert.ok(componentKeys.includes('component:react:card'));
      assert.ok(!componentKeys.includes('block:react:dashboard'));
    });
  });
  
  describe('Metadata Operations', () => {
    it('should retrieve metadata for stored items', async () => {
      const key = 'metadata:test';
      const value = { test: 'data' };
      
      await hybridStorage.set(key, value);
      const metadata = await hybridStorage.getMetadata(key);
      
      assert.notStrictEqual(metadata, null);
      assert.strictEqual(metadata.key, key);
      assert.ok(metadata.size > 0);
      assert.ok(metadata.createdAt instanceof Date);
      assert.ok(metadata.updatedAt instanceof Date);
    });
    
    it('should return null for non-existent metadata', async () => {
      const metadata = await hybridStorage.getMetadata('non:existent');
      assert.strictEqual(metadata, null);
    });
  });
  
  describe('Error Handling', () => {
    it('should handle invalid keys gracefully', async () => {
      await assert.rejects(hybridStorage.get(''));
      await assert.rejects(hybridStorage.set('', 'value'));
    });
    
    it('should handle disposal correctly', async () => {
      await hybridStorage.set('dispose:test', 'value');
      
      await hybridStorage.dispose();
      assert.strictEqual(hybridStorage.isDisposed(), true);
      
      // Operations after disposal should throw
      await assert.rejects(hybridStorage.get('dispose:test'));
      await assert.rejects(hybridStorage.set('new:key', 'value'));
    });
  });
  
  describe('Circuit Breaker', () => {
    it('should provide circuit breaker status', () => {
      const status = hybridStorage.getCircuitBreakerStatus();
      
      assert.ok(status.hasOwnProperty('state'));
      assert.ok(status.hasOwnProperty('failureCount'));
      assert.ok(status.hasOwnProperty('isRequestAllowed'));
    });
    
    it('should allow manual circuit breaker control', () => {
      // Initially should be closed
      let status = hybridStorage.getCircuitBreakerStatus();
      assert.strictEqual(status.isRequestAllowed, true);
      
      // Open manually
      hybridStorage.openCircuitBreaker();
      status = hybridStorage.getCircuitBreakerStatus();
      assert.strictEqual(status.isRequestAllowed, false);
      
      // Close manually
      hybridStorage.closeCircuitBreaker();
      status = hybridStorage.getCircuitBreakerStatus();
      assert.strictEqual(status.isRequestAllowed, true);
    });
  });
  
  describe('Size Tracking', () => {
    it('should track storage size', async () => {
      assert.strictEqual(await hybridStorage.size(), 0);
      
      await hybridStorage.set('size:1', 'value1');
      assert.strictEqual(await hybridStorage.size(), 1);
      
      await hybridStorage.set('size:2', 'value2');
      assert.strictEqual(await hybridStorage.size(), 2);
      
      await hybridStorage.delete('size:1');
      assert.strictEqual(await hybridStorage.size(), 1);
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
        assert.strictEqual(result, value);
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
        assert.strictEqual(value, `value${i}`);
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
      assert.strictEqual(await hybridStorage.get(key), 'initial');
      assert.strictEqual(await hybridStorage.get(`${key}:2`), 'write2');
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
    
    assert.strictEqual(value, 'value');
    
    const stats = storage.getStats();
    assert.strictEqual(stats.tierAvailability.memory, true);
    assert.strictEqual(stats.tierAvailability.pglite, false);
    assert.strictEqual(stats.tierAvailability.github, false);
    
    await storage.dispose();
  });
});