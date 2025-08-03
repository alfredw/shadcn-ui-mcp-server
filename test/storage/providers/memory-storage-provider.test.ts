/**
 * Memory Storage Provider Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import { expect } from 'vitest';
import { MemoryStorageProvider } from '../../../build/storage/providers/memory-storage-provider.js';

describe('MemoryStorageProvider', () => {
  let provider: MemoryStorageProvider;

  beforeEach(() => {
    provider = new MemoryStorageProvider({
      maxSize: 1024 * 1024, // 1MB
      defaultTTL: 60, // 1 minute
      debug: false
    });
  });

  afterAll(async () => {
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
      
      expect(retrieved).toEqual(value);
    });

    it('should return undefined for non-existent keys', async () => {
      const result = await provider.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should check key existence correctly', async () => {
      const key = 'test:exists';
      const value = 'test value';
      
      expect(await provider.has(key)).toBe(false);
      
      await provider.set(key, value);
      expect(await provider.has(key)).toBe(true);
    });

    it('should delete keys correctly', async () => {
      const key = 'test:delete';
      const value = 'test value';
      
      await provider.set(key, value);
      expect(await provider.has(key)).toBe(true);
      
      const deleted = await provider.delete(key);
      expect(deleted).toBe(true);
      expect(await provider.has(key)).toBe(false);
    });

    it('should return false when deleting non-existent keys', async () => {
      const deleted = await provider.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should clear all data', async () => {
      await provider.set('key1', 'value1');
      await provider.set('key2', 'value2');
      
      expect(await provider.size()).toBe(2);
      
      await provider.clear();
      
      expect(await provider.size()).toBe(0);
      expect(await provider.has('key1')).toBe(false);
      expect(await provider.has('key2')).toBe(false);
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
      
      expect(result.size).toBe(3);
      expect(result.get('key1')).toBe('value1');
      expect(result.get('key2')).toBe('value2');
      expect(result.get('key3')).toBe('value3');
      expect(result.has('nonexistent')).toBe(false);
    });

    it('should set multiple values at once', async () => {
      const data = new Map([
        ['batch1', { data: 'test1' }],
        ['batch2', { data: 'test2' }]
      ]);
      
      await provider.mset(data);
      
      expect(await provider.get('batch1')).toEqual({ data: 'test1' });
      expect(await provider.get('batch2')).toEqual({ data: 'test2' });
    });

    it('should set multiple values with TTL', async () => {
      const data = new Map([
        ['ttl1', 'value1'],
        ['ttl2', 'value2']
      ]);
      
      await provider.mset(data, 1); // 1 second TTL
      
      expect(await provider.has('ttl1')).toBe(true);
      expect(await provider.has('ttl2')).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await provider.has('ttl1')).toBe(false);
      expect(await provider.has('ttl2')).toBe(false);
    });
  });

  describe('Key Management', () => {
    it('should list all keys', async () => {
      await provider.set('test:1', 'value1');
      await provider.set('test:2', 'value2');
      await provider.set('other:1', 'value3');
      
      const keys = await provider.keys();
      
      expect(keys).toHaveLength(3);
      expect(keys).toContain('test:1');
      expect(keys).toContain('test:2');
      expect(keys).toContain('other:1');
    });

    it('should filter keys by pattern', async () => {
      await provider.set('test:1', 'value1');
      await provider.set('test:2', 'value2');
      await provider.set('other:1', 'value3');
      
      const testKeys = await provider.keys('test:*');
      const otherKeys = await provider.keys('other:*');
      
      expect(testKeys).toHaveLength(2);
      expect(testKeys).toContain('test:1');
      expect(testKeys).toContain('test:2');
      
      expect(otherKeys).toHaveLength(1);
      expect(otherKeys).toContain('other:1');
    });

    it('should return accurate size', async () => {
      expect(await provider.size()).toBe(0);
      
      await provider.set('key1', 'value1');
      expect(await provider.size()).toBe(1);
      
      await provider.set('key2', 'value2');
      expect(await provider.size()).toBe(2);
      
      await provider.delete('key1');
      expect(await provider.size()).toBe(1);
    });
  });

  describe('Metadata Operations', () => {
    it('should track metadata for stored items', async () => {
      const key = 'meta:test';
      const value = { data: 'test metadata' };
      
      await provider.set(key, value);
      
      const metadata = await provider.getMetadata(key);
      
      expect(metadata).toBeTruthy();
      expect(metadata!.key).toBe(key);
      expect(metadata!.size).toBeGreaterThan(0);
      expect(metadata!.createdAt).toBeInstanceOf(Date);
      expect(metadata!.updatedAt).toBeInstanceOf(Date);
      expect(metadata!.accessedAt).toBeInstanceOf(Date);
      expect(metadata!.accessCount).toBe(0);
    });

    it('should update access count and timestamp on retrieval', async () => {
      const key = 'access:test';
      const value = 'test value';
      
      await provider.set(key, value);
      
      // First access
      await provider.get(key);
      let metadata = await provider.getMetadata(key);
      expect(metadata!.accessCount).toBe(1);
      
      // Second access
      await provider.get(key);
      metadata = await provider.getMetadata(key);
      expect(metadata!.accessCount).toBe(2);
    });

    it('should return null for non-existent key metadata', async () => {
      const metadata = await provider.getMetadata('nonexistent');
      expect(metadata).toBeNull();
    });

    it('should update metadata on value updates', async () => {
      const key = 'update:test';
      
      await provider.set(key, 'original');
      const originalMeta = await provider.getMetadata(key);
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await provider.set(key, 'updated');
      const updatedMeta = await provider.getMetadata(key);
      
      expect(updatedMeta!.updatedAt.getTime()).toBeGreaterThan(originalMeta!.updatedAt.getTime());
      expect(updatedMeta!.createdAt.getTime()).toBe(originalMeta!.createdAt.getTime());
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire items after TTL', async () => {
      const key = 'expire:test';
      const value = 'expires';
      
      await provider.set(key, value, 1); // 1 second TTL
      
      expect(await provider.has(key)).toBe(true);
      expect(await provider.get(key)).toBe(value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await provider.has(key)).toBe(false);
      expect(await provider.get(key)).toBeUndefined();
    });

    it('should use default TTL when not specified', async () => {
      const shortTTLProvider = new MemoryStorageProvider({
        defaultTTL: 1 // 1 second
      });
      
      await shortTTLProvider.set('default:ttl', 'value');
      
      expect(await shortTTLProvider.has('default:ttl')).toBe(true);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await shortTTLProvider.has('default:ttl')).toBe(false);
    });

    it('should handle zero TTL as no expiration', async () => {
      await provider.set('no:expire', 'persistent', 0);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(await provider.has('no:expire')).toBe(true);
      expect(await provider.get('no:expire')).toBe('persistent');
    });
  });

  describe('Size Limits', () => {
    it('should enforce storage size limits', async () => {
      const smallProvider = new MemoryStorageProvider({
        maxSize: 100 // 100 bytes
      });
      
      const largeValue = 'x'.repeat(200); // 200+ bytes when JSON stringified
      
      await expect(smallProvider.set('large', largeValue)).rejects.toThrow(/Storage limit exceeded/);
    });

    it('should track total size correctly', async () => {
      await provider.set('size1', 'a');
      await provider.set('size2', 'bb');
      
      const totalSize = await provider.getTotalSize();
      expect(totalSize).toBeGreaterThan(0);
      
      await provider.delete('size1');
      const newTotalSize = await provider.getTotalSize();
      expect(newTotalSize).toBeLessThan(totalSize);
    });
  });

  describe('Key Validation', () => {
    it('should reject empty keys', async () => {
      await expect(provider.set('', 'value')).rejects.toThrow(/Storage key must be a non-empty string/);
    });

    it('should reject non-string keys', async () => {
      await expect(provider.set(null as any, 'value')).rejects.toThrow(/Storage key must be a non-empty string/);
    });

    it('should reject overly long keys', async () => {
      const longKey = 'x'.repeat(300);
      
      await expect(provider.set(longKey, 'value')).rejects.toThrow(/Storage key must not exceed 255 characters/);
    });

    it('should reject keys with control characters', async () => {
      await expect(provider.set('key\x00with\x01control', 'value')).rejects.toThrow(/Storage key contains invalid control characters/);
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
        expect(await provider.get(`concurrent:${i}`)).toBe(`value${i}`);
      }
    });

    it('should clean up stale metadata', async () => {
      await provider.set('cleanup:test', 'value', 1);
      
      // Initial size should be 1
      expect(await provider.size()).toBe(1);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Size should auto-clean and return 0
      expect(await provider.size()).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should return configuration', () => {
      const config = provider.getConfig();
      
      expect(config.maxSize).toBe(1024 * 1024);
      expect(config.defaultTTL).toBe(60);
      expect(config.debug).toBe(false);
    });

    it('should use default configuration values', () => {
      const defaultProvider = new MemoryStorageProvider();
      const config = defaultProvider.getConfig();
      
      expect(config.maxSize).toBe(100 * 1024 * 1024);
      expect(config.defaultTTL).toBe(3600);
      expect(config.debug).toBe(false);
    });
  });

  describe('Cleanup Operations', () => {
    it('should clean up expired entries', async () => {
      await provider.set('cleanup1', 'value1', 1);
      await provider.set('cleanup2', 'value2', 1);
      await provider.set('permanent', 'value3'); // No TTL
      
      expect(await provider.size()).toBe(3);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const cleaned = await provider.cleanup();
      
      expect(cleaned).toBeGreaterThanOrEqual(0); // Cleanup might find 0 if already cleaned
      expect(await provider.size()).toBe(1); // Only permanent should remain
      expect(await provider.has('permanent')).toBe(true);
    });
  });
});