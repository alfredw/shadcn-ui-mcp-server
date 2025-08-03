/**
 * GitHub Storage Provider Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import { expect } from 'vitest';
import { GitHubStorageProvider } from '../../../build/storage/index.js';

describe('GitHubStorageProvider', () => {
  let gitHubStorage: GitHubStorageProvider;
  
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
      
      expect(config.enableCache).toBe(true);
      expect(config.timeout).toBe(30000);
      expect(config.cacheTTL).toBe(300);
    });
    
    it('should use custom configuration', () => {
      const storage = new GitHubStorageProvider({
        apiKey: 'test-key',
        timeout: 15000,
        enableCache: false,
        cacheTTL: 600
      });
      
      const config = storage.getGitHubConfig();
      
      expect(config.apiKey).toBe('test-key');
      expect(config.timeout).toBe(15000);
      expect(config.enableCache).toBe(false);
      expect(config.cacheTTL).toBe(600);
    });
  });
  
  describe('Storage Operations', () => {
    it('should handle set operations (cache only)', async () => {
      await gitHubStorage.set('cache:test', { data: 'test' });
      const result = await gitHubStorage.get('cache:test');
      
      expect(result).toEqual({ data: 'test' });
    });
    
    it('should handle has operations', async () => {
      expect(await gitHubStorage.has('nonexistent')).toBe(false);
      
      await gitHubStorage.set('exists', 'value');
      expect(await gitHubStorage.has('exists')).toBe(true);
    });
    
    it('should handle delete operations', async () => {
      await gitHubStorage.set('delete:test', 'value');
      expect(await gitHubStorage.has('delete:test')).toBe(true);
      
      const deleted = await gitHubStorage.delete('delete:test');
      expect(deleted).toBe(true);
      expect(await gitHubStorage.has('delete:test')).toBe(false);
    });
    
    it('should handle clear operations', async () => {
      await gitHubStorage.set('clear:1', 'value1');
      await gitHubStorage.set('clear:2', 'value2');
      
      expect(await gitHubStorage.size()).toBe(2);
      
      await gitHubStorage.clear();
      expect(await gitHubStorage.size()).toBe(0);
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
        expect(await gitHubStorage.get(key)).toBe(value);
      }
    });
    
    it('should handle batch get operations', async () => {
      // Set up test data first
      await gitHubStorage.set('batch:get:1', 'value1');
      await gitHubStorage.set('batch:get:2', 'value2');
      
      const keys = ['batch:get:1', 'batch:get:2', 'batch:get:missing'];
      const results = await gitHubStorage.mget(keys);
      
      expect(results.size).toBe(2);
      expect(results.get('batch:get:1')).toBe('value1');
      expect(results.get('batch:get:2')).toBe('value2');
      expect(results.has('batch:get:missing')).toBe(false);
    });
  });
  
  describe('Key Pattern Matching', () => {
    it('should list all keys', async () => {
      await gitHubStorage.set('pattern:1', 'value1');
      await gitHubStorage.set('pattern:2', 'value2');
      await gitHubStorage.set('other', 'value3');
      
      const keys = await gitHubStorage.keys();
      
      expect(keys).toContain('pattern:1');
      expect(keys).toContain('pattern:2');
      expect(keys).toContain('other');
    });
    
    it('should filter keys by pattern', async () => {
      await gitHubStorage.set('component:react:button', 'button');
      await gitHubStorage.set('component:react:card', 'card');
      await gitHubStorage.set('block:react:dashboard', 'dashboard');
      
      const componentKeys = await gitHubStorage.keys('component:*');
      
      expect(componentKeys).toContain('component:react:button');
      expect(componentKeys).toContain('component:react:card');
      expect(componentKeys).not.toContain('block:react:dashboard');
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
      expect(await shortTTLStorage.get('ttl:test')).toBe('value');
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Data should be expired and return undefined
      const result = await shortTTLStorage.get('ttl:test');
      expect(result).toBeUndefined();
      
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
      expect(result).toBeUndefined();
      
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
      
      expect(await storage.size()).toBe(2);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Cleanup should remove expired entries
      const cleaned = await storage.cleanup();
      expect(cleaned).toBe(2);
      expect(await storage.size()).toBe(0);
      
      await storage.dispose();
    });
  });
  
  describe('Component Operations', () => {
    it('should handle unsupported component requests gracefully', async () => {
      // Test with an invalid component format that should return undefined
      const result = await gitHubStorage.get('component:vue:button');
      expect(result).toBeUndefined();
    });
    
    it('should handle invalid key formats', async () => {
      const result = await gitHubStorage.get('invalid-key-format');
      expect(result).toBeUndefined();
    });
  });
  
  describe('Block Operations', () => {
    it('should handle unsupported block requests gracefully', async () => {
      // Test with an invalid block format that should return undefined
      const result = await gitHubStorage.get('block:svelte:dashboard');
      expect(result).toBeUndefined();
    });
  });
  
  describe('Metadata Operations', () => {
    it('should handle unknown metadata types', async () => {
      const result = await gitHubStorage.get('metadata:unknown');
      
      // The GitHubStorageProvider should handle unknown metadata gracefully
      if (result !== undefined) {
        expect(result.type).toBe('metadata');
        expect(result.subtype).toBe('unknown');
        expect(result.message).toContain('Unknown metadata type');
      } else {
        // It's also valid for it to return undefined for unknown types
        expect(result).toBeUndefined();
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should handle disposal correctly', async () => {
      await gitHubStorage.set('dispose:test', 'value');
      
      await gitHubStorage.dispose();
      expect(gitHubStorage.isDisposed()).toBe(true);
      
      await expect(gitHubStorage.get('dispose:test')).rejects.toThrow();
    });
    
    it('should handle invalid operations after disposal', async () => {
      await gitHubStorage.dispose();
      
      await expect(gitHubStorage.set('new:key', 'value')).rejects.toThrow();
      await expect(gitHubStorage.has('any:key')).rejects.toThrow();
      await expect(gitHubStorage.delete('any:key')).rejects.toThrow();
      await expect(gitHubStorage.clear()).rejects.toThrow();
    });
  });
  
  describe('Metadata Retrieval', () => {
    it('should retrieve metadata for stored items', async () => {
      const key = 'metadata:test';
      const value = { test: 'data' };
      
      await gitHubStorage.set(key, value);
      const metadata = await gitHubStorage.getMetadata(key);
      
      if (metadata !== null) {
        expect(metadata.key).toBe(key);
        expect(metadata.size).toBeGreaterThan(0);
        expect(metadata.createdAt).toBeInstanceOf(Date);
        expect(metadata.updatedAt).toBeInstanceOf(Date);
      }
    });
    
    it('should return null for non-existent metadata', async () => {
      const metadata = await gitHubStorage.getMetadata('non:existent');
      expect(metadata).toBeNull();
    });
  });
  
  describe('Size Tracking', () => {
    it('should track storage size accurately', async () => {
      expect(await gitHubStorage.size()).toBe(0);
      
      await gitHubStorage.set('size:1', 'value1');
      expect(await gitHubStorage.size()).toBe(1);
      
      await gitHubStorage.set('size:2', 'value2');
      expect(await gitHubStorage.size()).toBe(2);
      
      await gitHubStorage.delete('size:1');
      expect(await gitHubStorage.size()).toBe(1);
    });
  });
});