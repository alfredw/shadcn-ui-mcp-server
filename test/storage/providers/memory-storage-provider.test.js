import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { MemoryStorageProvider } from '../../../build/storage/providers/memory-storage-provider.js';

describe('MemoryStorageProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new MemoryStorageProvider({
      maxSize: 1024 * 1024, // 1MB
      defaultTTL: 60, // 1 minute
      debug: false
    });
  });

  after(async () => {
    if (provider) {
      await provider.clear();
    }
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', async () => {
      const key = 'test:key';
      const value = { data: 'test data' };
      
      await provider.set(key, value);
      const retrieved = await provider.get(key);
      
      assert.deepStrictEqual(retrieved, value);
    });

    it('should return undefined for non-existent keys', async () => {
      const result = await provider.get('non-existent');
      assert.strictEqual(result, undefined);
    });

    it('should check key existence correctly', async () => {
      const key = 'test:exists';
      const value = 'test value';
      
      assert.strictEqual(await provider.has(key), false);
      
      await provider.set(key, value);
      assert.strictEqual(await provider.has(key), true);
    });

    it('should delete keys correctly', async () => {
      const key = 'test:delete';
      const value = 'test value';
      
      await provider.set(key, value);
      assert.strictEqual(await provider.has(key), true);
      
      const deleted = await provider.delete(key);
      assert.strictEqual(deleted, true);
      assert.strictEqual(await provider.has(key), false);
    });

    it('should return false when deleting non-existent keys', async () => {
      const deleted = await provider.delete('non-existent');
      assert.strictEqual(deleted, false);
    });

    it('should clear all data', async () => {
      await provider.set('key1', 'value1');
      await provider.set('key2', 'value2');
      
      assert.strictEqual(await provider.size(), 2);
      
      await provider.clear();
      
      assert.strictEqual(await provider.size(), 0);
      assert.strictEqual(await provider.has('key1'), false);
      assert.strictEqual(await provider.has('key2'), false);
    });
  });

  describe('Batch Operations', () => {
    it('should get multiple values at once', async () => {
      const data = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3']
      ]);
      
      await provider.mset(data);
      
      const result = await provider.mget(['key1', 'key2', 'key3', 'nonexistent']);
      
      assert.strictEqual(result.size, 3);
      assert.strictEqual(result.get('key1'), 'value1');
      assert.strictEqual(result.get('key2'), 'value2');
      assert.strictEqual(result.get('key3'), 'value3');
      assert.strictEqual(result.has('nonexistent'), false);
    });

    it('should set multiple values at once', async () => {
      const data = new Map([
        ['batch1', { data: 'test1' }],
        ['batch2', { data: 'test2' }]
      ]);
      
      await provider.mset(data);
      
      assert.deepStrictEqual(await provider.get('batch1'), { data: 'test1' });
      assert.deepStrictEqual(await provider.get('batch2'), { data: 'test2' });
    });

    it('should set multiple values with TTL', async () => {
      const data = new Map([
        ['ttl1', 'value1'],
        ['ttl2', 'value2']
      ]);
      
      await provider.mset(data, 1); // 1 second TTL
      
      assert.strictEqual(await provider.has('ttl1'), true);
      assert.strictEqual(await provider.has('ttl2'), true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      assert.strictEqual(await provider.has('ttl1'), false);
      assert.strictEqual(await provider.has('ttl2'), false);
    });
  });

  describe('Key Management', () => {
    it('should list all keys', async () => {
      await provider.set('test:1', 'value1');
      await provider.set('test:2', 'value2');
      await provider.set('other:1', 'value3');
      
      const keys = await provider.keys();
      
      assert.strictEqual(keys.length, 3);
      assert.ok(keys.includes('test:1'));
      assert.ok(keys.includes('test:2'));
      assert.ok(keys.includes('other:1'));
    });

    it('should filter keys by pattern', async () => {
      await provider.set('test:1', 'value1');
      await provider.set('test:2', 'value2');
      await provider.set('other:1', 'value3');
      
      const testKeys = await provider.keys('test:*');
      const otherKeys = await provider.keys('other:*');
      
      assert.strictEqual(testKeys.length, 2);
      assert.ok(testKeys.includes('test:1'));
      assert.ok(testKeys.includes('test:2'));
      
      assert.strictEqual(otherKeys.length, 1);
      assert.ok(otherKeys.includes('other:1'));
    });

    it('should return accurate size', async () => {
      assert.strictEqual(await provider.size(), 0);
      
      await provider.set('key1', 'value1');
      assert.strictEqual(await provider.size(), 1);
      
      await provider.set('key2', 'value2');
      assert.strictEqual(await provider.size(), 2);
      
      await provider.delete('key1');
      assert.strictEqual(await provider.size(), 1);
    });
  });

  describe('Metadata Operations', () => {
    it('should track metadata for stored items', async () => {
      const key = 'meta:test';
      const value = { data: 'test metadata' };
      
      await provider.set(key, value);
      
      const metadata = await provider.getMetadata(key);
      
      assert.ok(metadata);
      assert.strictEqual(metadata.key, key);
      assert.ok(metadata.size > 0);
      assert.ok(metadata.createdAt instanceof Date);
      assert.ok(metadata.updatedAt instanceof Date);
      assert.ok(metadata.accessedAt instanceof Date);
      assert.strictEqual(metadata.accessCount, 0);
    });

    it('should update access count and timestamp on retrieval', async () => {
      const key = 'access:test';
      const value = 'test value';
      
      await provider.set(key, value);
      
      // First access
      await provider.get(key);
      let metadata = await provider.getMetadata(key);
      assert.strictEqual(metadata.accessCount, 1);
      
      // Second access
      await provider.get(key);
      metadata = await provider.getMetadata(key);
      assert.strictEqual(metadata.accessCount, 2);
    });

    it('should return null for non-existent key metadata', async () => {
      const metadata = await provider.getMetadata('nonexistent');
      assert.strictEqual(metadata, null);
    });

    it('should update metadata on value updates', async () => {
      const key = 'update:test';
      
      await provider.set(key, 'original');
      const originalMeta = await provider.getMetadata(key);
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await provider.set(key, 'updated');
      const updatedMeta = await provider.getMetadata(key);
      
      assert.ok(updatedMeta.updatedAt > originalMeta.updatedAt);
      assert.strictEqual(updatedMeta.createdAt.getTime(), originalMeta.createdAt.getTime());
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire items after TTL', async () => {
      const key = 'expire:test';
      const value = 'expires';
      
      await provider.set(key, value, 1); // 1 second TTL
      
      assert.strictEqual(await provider.has(key), true);
      assert.strictEqual(await provider.get(key), value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      assert.strictEqual(await provider.has(key), false);
      assert.strictEqual(await provider.get(key), undefined);
    });

    it('should use default TTL when not specified', async () => {
      const shortTTLProvider = new MemoryStorageProvider({
        defaultTTL: 1 // 1 second
      });
      
      await shortTTLProvider.set('default:ttl', 'value');
      
      assert.strictEqual(await shortTTLProvider.has('default:ttl'), true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      assert.strictEqual(await shortTTLProvider.has('default:ttl'), false);
    });

    it('should handle zero TTL as no expiration', async () => {
      await provider.set('no:expire', 'persistent', 0);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      assert.strictEqual(await provider.has('no:expire'), true);
      assert.strictEqual(await provider.get('no:expire'), 'persistent');
    });
  });

  describe('Size Limits', () => {
    it('should enforce storage size limits', async () => {
      const smallProvider = new MemoryStorageProvider({
        maxSize: 100 // 100 bytes
      });
      
      const largeValue = 'x'.repeat(200); // 200+ bytes when JSON stringified
      
      await assert.rejects(
        async () => await smallProvider.set('large', largeValue),
        /Storage limit exceeded/
      );
    });

    it('should track total size correctly', async () => {
      await provider.set('size1', 'a');
      await provider.set('size2', 'bb');
      
      const totalSize = await provider.getTotalSize();
      assert.ok(totalSize > 0);
      
      await provider.delete('size1');
      const newTotalSize = await provider.getTotalSize();
      assert.ok(newTotalSize < totalSize);
    });
  });

  describe('Key Validation', () => {
    it('should reject empty keys', async () => {
      await assert.rejects(
        async () => await provider.set('', 'value'),
        /Storage key must be a non-empty string/
      );
    });

    it('should reject non-string keys', async () => {
      await assert.rejects(
        async () => await provider.set(null, 'value'),
        /Storage key must be a non-empty string/
      );
    });

    it('should reject overly long keys', async () => {
      const longKey = 'x'.repeat(300);
      
      await assert.rejects(
        async () => await provider.set(longKey, 'value'),
        /Storage key must not exceed 255 characters/
      );
    });

    it('should reject keys with control characters', async () => {
      await assert.rejects(
        async () => await provider.set('key\x00with\x01control', 'value'),
        /Storage key contains invalid control characters/
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle concurrent operations gracefully', async () => {
      const promises = [];
      
      // Concurrent sets
      for (let i = 0; i < 10; i++) {
        promises.push(provider.set(`concurrent:${i}`, `value${i}`));
      }
      
      await Promise.all(promises);
      
      // Verify all were set
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(await provider.get(`concurrent:${i}`), `value${i}`);
      }
    });

    it('should clean up stale metadata', async () => {
      await provider.set('cleanup:test', 'value', 1);
      
      // Initial size should be 1
      assert.strictEqual(await provider.size(), 1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Size should auto-clean and return 0
      assert.strictEqual(await provider.size(), 0);
    });
  });

  describe('Configuration', () => {
    it('should return configuration', () => {
      const config = provider.getConfig();
      
      assert.strictEqual(config.maxSize, 1024 * 1024);
      assert.strictEqual(config.defaultTTL, 60);
      assert.strictEqual(config.debug, false);
    });

    it('should use default configuration values', () => {
      const defaultProvider = new MemoryStorageProvider();
      const config = defaultProvider.getConfig();
      
      assert.strictEqual(config.maxSize, 100 * 1024 * 1024);
      assert.strictEqual(config.defaultTTL, 3600);
      assert.strictEqual(config.debug, false);
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up expired entries', async () => {
      await provider.set('cleanup1', 'value1', 1);
      await provider.set('cleanup2', 'value2', 1);
      await provider.set('permanent', 'value3'); // No TTL
      
      assert.strictEqual(await provider.size(), 3);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const cleaned = await provider.cleanup();
      
      assert.ok(cleaned >= 0); // Cleanup might find 0 if already cleaned
      assert.strictEqual(await provider.size(), 1); // Only permanent should remain
      assert.strictEqual(await provider.has('permanent'), true);
    });
  });
});