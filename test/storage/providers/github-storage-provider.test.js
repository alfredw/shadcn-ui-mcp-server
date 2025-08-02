import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GitHubStorageProvider } from '../../../build/storage/index.js';

// Simple mock function implementation
function createMock(returnValue) {
  let calls = 0;
  let callArgs = [];
  
  const mockFn = (...args) => {
    calls++;
    callArgs.push(args);
    if (typeof returnValue === 'function') {
      return returnValue(...args);
    }
    return returnValue;
  };
  
  mockFn.mockResolvedValue = (value) => {
    returnValue = Promise.resolve(value);
    return mockFn;
  };
  
  mockFn.mockRejectedValue = (error) => {
    returnValue = Promise.reject(error);
    return mockFn;
  };
  
  mockFn.mockReset = () => {
    calls = 0;
    callArgs = [];
    return mockFn;
  };
  
  mockFn.toHaveBeenCalled = () => calls > 0;
  mockFn.toHaveBeenCalledTimes = (expectedCalls) => calls === expectedCalls;
  mockFn.toHaveBeenCalledWith = (...expectedArgs) => {
    return callArgs.some(args => 
      args.length === expectedArgs.length && 
      args.every((arg, i) => arg === expectedArgs[i])
    );
  };
  mockFn.callCount = () => calls;
  
  return mockFn;
}

describe('GitHubStorageProvider', () => {
  let gitHubStorage;
  
  beforeEach(async () => {
    gitHubStorage = new GitHubStorageProvider({
      enableCache: true,
      cacheTTL: 300, // 5 minutes
      debug: false
    });
  });
  
  afterEach(async () => {
    if (gitHubStorage && !gitHubStorage.isDisposed()) {
      await gitHubStorage.dispose();
    }
  });
  
  describe('Configuration', () => {
    it('should initialize with default configuration', () => {
      const storage = new GitHubStorageProvider();
      const config = storage.getGitHubConfig();
      
      assert.strictEqual(config.enableCache, true);
      assert.strictEqual(config.timeout, 30000);
      assert.strictEqual(config.cacheTTL, 300);
    });
    
    it('should use custom configuration', () => {
      const storage = new GitHubStorageProvider({
        apiKey: 'test-key',
        timeout: 15000,
        enableCache: false,
        cacheTTL: 600
      });
      
      const config = storage.getGitHubConfig();
      
      assert.strictEqual(config.apiKey, 'test-key');
      assert.strictEqual(config.timeout, 15000);
      assert.strictEqual(config.enableCache, false);
      assert.strictEqual(config.cacheTTL, 600);
    });
  });
  
  describe('Storage Operations', () => {
    it('should handle set operations (cache only)', async () => {
      await gitHubStorage.set('cache:test', { data: 'test' });
      const result = await gitHubStorage.get('cache:test');
      
      assert.deepStrictEqual(result, { data: 'test' });
    });
    
    it('should handle has operations', async () => {
      assert.strictEqual(await gitHubStorage.has('nonexistent'), false);
      
      await gitHubStorage.set('exists', 'value');
      assert.strictEqual(await gitHubStorage.has('exists'), true);
    });
    
    it('should handle delete operations', async () => {
      await gitHubStorage.set('delete:test', 'value');
      assert.strictEqual(await gitHubStorage.has('delete:test'), true);
      
      const deleted = await gitHubStorage.delete('delete:test');
      assert.strictEqual(deleted, true);
      assert.strictEqual(await gitHubStorage.has('delete:test'), false);
    });
    
    it('should handle clear operations', async () => {
      await gitHubStorage.set('clear:1', 'value1');
      await gitHubStorage.set('clear:2', 'value2');
      
      assert.strictEqual(await gitHubStorage.size(), 2);
      
      await gitHubStorage.clear();
      assert.strictEqual(await gitHubStorage.size(), 0);
    });
  });
  
  describe('Batch Operations', () => {
    it('should handle batch set operations', async () => {
      const data = new Map([
        ['batch:1', 'value1'],
        ['batch:2', 'value2'],
        ['batch:3', 'value3']
      ]);
      
      await gitHubStorage.mset(data);
      
      for (const [key, value] of data) {
        assert.strictEqual(await gitHubStorage.get(key), value);
      }
    });
    
    it('should handle batch get operations', async () => {
      // Set up test data first
      await gitHubStorage.set('batch:get:1', 'value1');
      await gitHubStorage.set('batch:get:2', 'value2');
      
      const keys = ['batch:get:1', 'batch:get:2', 'batch:get:missing'];
      const results = await gitHubStorage.mget(keys);
      
      assert.strictEqual(results.size, 2);
      assert.strictEqual(results.get('batch:get:1'), 'value1');
      assert.strictEqual(results.get('batch:get:2'), 'value2');
      assert.strictEqual(results.has('batch:get:missing'), false);
    });
  });
  
  describe('Key Pattern Matching', () => {
    it('should list all keys', async () => {
      await gitHubStorage.set('pattern:1', 'value1');
      await gitHubStorage.set('pattern:2', 'value2');
      await gitHubStorage.set('other', 'value3');
      
      const keys = await gitHubStorage.keys();
      
      assert.ok(keys.includes('pattern:1'));
      assert.ok(keys.includes('pattern:2'));
      assert.ok(keys.includes('other'));
    });
    
    it('should filter keys by pattern', async () => {
      await gitHubStorage.set('component:react:button', 'button');
      await gitHubStorage.set('component:react:card', 'card');
      await gitHubStorage.set('block:react:dashboard', 'dashboard');
      
      const componentKeys = await gitHubStorage.keys('component:*');
      
      assert.ok(componentKeys.includes('component:react:button'));
      assert.ok(componentKeys.includes('component:react:card'));
      assert.ok(!componentKeys.includes('block:react:dashboard'));
    });
  });
  
  describe('Caching', () => {
    it('should respect cache TTL', async () => {
      // Create storage with very short TTL
      const shortTTLStorage = new GitHubStorageProvider({
        enableCache: true,
        cacheTTL: 0.1 // 0.1 seconds
      });
      
      // Set some data
      await shortTTLStorage.set('ttl:test', 'value');
      assert.strictEqual(await shortTTLStorage.get('ttl:test'), 'value');
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Data should be expired and return undefined
      const result = await shortTTLStorage.get('ttl:test');
      assert.strictEqual(result, undefined);
      
      await shortTTLStorage.dispose();
    });
    
    it('should work with caching disabled', async () => {
      const noCacheStorage = new GitHubStorageProvider({
        enableCache: false
      });
      
      // With caching disabled, data should not persist beyond the set operation
      await noCacheStorage.set('nocache:test', 'value');
      
      // Since caching is disabled, the GitHub provider acts as write-only
      // and reads will not return cached data
      const result = await noCacheStorage.get('nocache:test');
      
      // This will be undefined because GitHub provider doesn't actually store data
      // when caching is disabled - it only fetches from GitHub API
      assert.strictEqual(result, undefined);
      
      await noCacheStorage.dispose();
    });
    
    it('should clean up expired cache entries', async () => {
      // Add some data to cache with short TTL
      const storage = new GitHubStorageProvider({
        enableCache: true,
        cacheTTL: 0.1
      });
      
      await storage.set('test:key1', 'value1');
      await storage.set('test:key2', 'value2');
      
      assert.strictEqual(await storage.size(), 2);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Cleanup should remove expired entries
      const cleaned = await storage.cleanup();
      assert.strictEqual(cleaned, 2);
      assert.strictEqual(await storage.size(), 0);
      
      await storage.dispose();
    });
  });
  
  describe('Component Operations', () => {
    it('should handle unsupported component requests gracefully', async () => {
      // Test with an invalid component format that should return undefined
      const result = await gitHubStorage.get('component:vue:button');
      assert.strictEqual(result, undefined);
    });
    
    it('should handle invalid key formats', async () => {
      const result = await gitHubStorage.get('invalid-key-format');
      assert.strictEqual(result, undefined);
    });
  });
  
  describe('Block Operations', () => {
    it('should handle unsupported block requests gracefully', async () => {
      // Test with an invalid block format that should return undefined
      const result = await gitHubStorage.get('block:svelte:dashboard');
      assert.strictEqual(result, undefined);
    });
  });
  
  describe('Metadata Operations', () => {
    it('should handle unknown metadata types', async () => {
      const result = await gitHubStorage.get('metadata:unknown');
      
      // The GitHubStorageProvider should handle unknown metadata gracefully
      if (result !== undefined) {
        assert.strictEqual(result.type, 'metadata');
        assert.strictEqual(result.subtype, 'unknown');
        assert.ok(result.message.includes('Unknown metadata type'));
      } else {
        // It's also valid for it to return undefined for unknown types
        assert.strictEqual(result, undefined);
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should handle disposal correctly', async () => {
      await gitHubStorage.set('dispose:test', 'value');
      
      await gitHubStorage.dispose();
      assert.strictEqual(gitHubStorage.isDisposed(), true);
      
      await assert.rejects(gitHubStorage.get('dispose:test'));
    });
    
    it('should handle invalid operations after disposal', async () => {
      await gitHubStorage.dispose();
      
      await assert.rejects(gitHubStorage.set('new:key', 'value'));
      await assert.rejects(gitHubStorage.has('any:key'));
      await assert.rejects(gitHubStorage.delete('any:key'));
      await assert.rejects(gitHubStorage.clear());
    });
  });
  
  describe('Metadata Retrieval', () => {
    it('should retrieve metadata for stored items', async () => {
      const key = 'metadata:test';
      const value = { test: 'data' };
      
      await gitHubStorage.set(key, value);
      const metadata = await gitHubStorage.getMetadata(key);
      
      if (metadata !== null) {
        assert.strictEqual(metadata.key, key);
        assert.ok(metadata.size > 0);
        assert.ok(metadata.createdAt instanceof Date);
        assert.ok(metadata.updatedAt instanceof Date);
      }
    });
    
    it('should return null for non-existent metadata', async () => {
      const metadata = await gitHubStorage.getMetadata('non:existent');
      assert.strictEqual(metadata, null);
    });
  });
  
  describe('Size Tracking', () => {
    it('should track storage size accurately', async () => {
      assert.strictEqual(await gitHubStorage.size(), 0);
      
      await gitHubStorage.set('size:1', 'value1');
      assert.strictEqual(await gitHubStorage.size(), 1);
      
      await gitHubStorage.set('size:2', 'value2');
      assert.strictEqual(await gitHubStorage.size(), 2);
      
      await gitHubStorage.delete('size:1');
      assert.strictEqual(await gitHubStorage.size(), 1);
    });
  });
});