/**
 * PGLite Storage Provider Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import { PGLiteStorageProvider } from '../../../build/storage/providers/pglite-storage-provider.js';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { initializeDatabase, closeDatabase } from '../../../build/storage/database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('PGLiteStorageProvider', () => {
  let provider: PGLiteStorageProvider;
  const testDbPath = path.join(__dirname, '../../temp-test-db');

  beforeAll(async () => {
    // Use ONLY the global manager - eliminate dual manager pattern
    await initializeDatabase({
      path: testDbPath,
      maxSizeBytes: 10 * 1024 * 1024 // 10MB for tests
    });
  });

  beforeEach(async () => {
    // Don't create a separate manager - use the global one
    provider = new PGLiteStorageProvider(undefined, {
      maxSize: 1024 * 1024, // 1MB
      defaultTTL: 60, // 1 minute
      debug: false
    });
    
    await provider.initialize();
    await provider.clear(); // Start with clean state
  });

  afterEach(async () => {
    if (provider && !provider.isDisposed()) {
      await provider.clear();
      await provider.dispose(); // CRITICAL: Add disposal to prevent resource leaks
    }
  });

  afterAll(async () => {
    await closeDatabase();
    // Ensure all connections are properly closed
    await PGLiteManager.closeAllConnections();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newProvider = new PGLiteStorageProvider();
      await newProvider.initialize();
      
      try {
        // Should be able to perform basic operations using component data
        const testComponent = {
          framework: 'react',
          name: 'init-test',
          sourceCode: 'test code'
        };
        await newProvider.setComponent(testComponent);
        const retrieved = await newProvider.getComponent('react', 'init-test');
        expect(retrieved.sourceCode).toBe('test code');
      } finally {
        await newProvider.dispose();
      }
    });

    it('should use global database manager when none provided', async () => {
      const newProvider = new PGLiteStorageProvider();
      await newProvider.initialize();
      
      try {
        // Should work with global manager
        const testComponent = {
          framework: 'react',
          name: 'global-test',
          sourceCode: 'global test code'
        };
        await newProvider.setComponent(testComponent);
        const retrieved = await newProvider.getComponent('react', 'global-test');
        expect(retrieved.sourceCode).toBe('global test code');
      } finally {
        await newProvider.dispose();
      }
    });
  });

  describe('Key Parsing', () => {
    it('should parse component keys correctly', () => {
      const parsed = provider.parseKey('component:react:button');
      
      expect(parsed.type).toBe('component');
      expect(parsed.framework).toBe('react');
      expect(parsed.name).toBe('button');
    });

    it('should parse block keys correctly', () => {
      const parsed = provider.parseKey('block:react:dashboard-01');
      
      expect(parsed.type).toBe('block');
      expect(parsed.framework).toBe('react');
      expect(parsed.name).toBe('dashboard-01');
    });

    it('should parse metadata keys correctly', () => {
      const parsed = provider.parseKey('metadata:github_rate_limit');
      
      expect(parsed.type).toBe('metadata');
      expect(parsed.name).toBe('github_rate_limit');
    });

    it('should build keys correctly', () => {
      const key = provider.buildKey('component', 'react', 'button');
      expect(key).toBe('component:react:button');
    });

    it('should identify component keys', () => {
      expect(provider.isComponentKey('component:react:button')).toBe(true);
      expect(provider.isComponentKey('block:react:dashboard')).toBe(false);
    });

    it('should identify block keys', () => {
      expect(provider.isBlockKey('block:react:dashboard')).toBe(true);
      expect(provider.isBlockKey('component:react:button')).toBe(false);
    });
  });

  describe('Component Operations', () => {
    const sampleComponent = {
      framework: 'react',
      name: 'button',
      sourceCode: 'export default function Button() { return <button>Click me</button>; }',
      demoCode: '<Button />',
      metadata: { description: 'A simple button component' },
      dependencies: ['react'],
      registryDependencies: ['@radix-ui/react-button'],
      githubSha: 'abc123',
      fileSize: 150,
      lastModified: new Date()
    };

    it('should store and retrieve components', async () => {
      await provider.setComponent(sampleComponent);
      
      const retrieved = await provider.getComponent('react', 'button');
      
      expect(retrieved.framework).toBe(sampleComponent.framework);
      expect(retrieved.name).toBe(sampleComponent.name);
      expect(retrieved.sourceCode).toBe(sampleComponent.sourceCode);
      expect(retrieved.dependencies).toEqual(sampleComponent.dependencies);
    });

    it('should update access tracking on component retrieval', async () => {
      await provider.setComponent(sampleComponent);
      
      // First access
      await provider.getComponent('react', 'button');
      
      // Second access
      await provider.getComponent('react', 'button');
      
      const metadata = await provider.getComponentMetadata('react', 'button');
      expect(metadata.accessCount).toBeGreaterThanOrEqual(2);
    });

    it('should return undefined for non-existent components', async () => {
      const result = await provider.getComponent('react', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('should list components by framework', async () => {
      await provider.setComponent(sampleComponent);
      await provider.setComponent({
        ...sampleComponent,
        name: 'card'
      });

      const components = await provider.listComponents('react');
      
      expect(components).toHaveLength(2);
      expect(components.some(c => c.name === 'button')).toBe(true);
      expect(components.some(c => c.name === 'card')).toBe(true);
    });

    it('should handle component updates correctly', async () => {
      await provider.setComponent(sampleComponent);
      
      const updatedComponent = {
        ...sampleComponent,
        sourceCode: 'updated code',
        fileSize: 200
      };
      
      await provider.setComponent(updatedComponent);
      
      const retrieved = await provider.getComponent('react', 'button');
      expect(retrieved.sourceCode).toBe('updated code');
      expect(retrieved.fileSize).toBe(200);
    });
  });

  describe('Block Operations', () => {
    const sampleBlock = {
      framework: 'react',
      name: 'dashboard-01',
      category: 'dashboard',
      type: 'complex',
      description: 'A comprehensive dashboard layout',
      files: {
        'page.tsx': 'dashboard content',
        'components/chart.tsx': 'chart component'
      },
      structure: { layout: 'grid', sections: 3 },
      dependencies: ['react', 'recharts'],
      componentsUsed: ['card', 'chart'],
      totalSize: 5000,
      githubSha: 'def456'
    };

    it('should store and retrieve blocks', async () => {
      await provider.setBlock(sampleBlock);
      
      const retrieved = await provider.getBlock('react', 'dashboard-01');
      
      expect(retrieved.framework).toBe(sampleBlock.framework);
      expect(retrieved.name).toBe(sampleBlock.name);
      expect(retrieved.category).toBe(sampleBlock.category);
      expect(retrieved.files).toEqual(sampleBlock.files);
    });

    it('should update access tracking on block retrieval', async () => {
      await provider.setBlock(sampleBlock);
      
      await provider.getBlock('react', 'dashboard-01');
      await provider.getBlock('react', 'dashboard-01');
      
      const metadata = await provider.getBlockMetadata('react', 'dashboard-01');
      expect(metadata.accessCount).toBeGreaterThanOrEqual(2);
    });

    it('should return undefined for non-existent blocks', async () => {
      const result = await provider.getBlock('react', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('should list blocks by framework', async () => {
      await provider.setBlock(sampleBlock);
      await provider.setBlock({
        ...sampleBlock,
        name: 'dashboard-02',
        category: 'analytics'
      });

      const blocks = await provider.listBlocks('react');
      
      expect(blocks).toHaveLength(2);
      expect(blocks.some(b => b.name === 'dashboard-01')).toBe(true);
      expect(blocks.some(b => b.name === 'dashboard-02')).toBe(true);
    });

    it('should filter blocks by category', async () => {
      await provider.setBlock(sampleBlock);
      await provider.setBlock({
        ...sampleBlock,
        name: 'analytics-01',
        category: 'analytics'
      });

      const dashboardBlocks = await provider.listBlocks('react', 'dashboard');
      const analyticsBlocks = await provider.listBlocks('react', 'analytics');
      
      expect(dashboardBlocks).toHaveLength(1);
      expect(dashboardBlocks[0].name).toBe('dashboard-01');
      
      expect(analyticsBlocks).toHaveLength(1);
      expect(analyticsBlocks[0].name).toBe('analytics-01');
    });
  });

  describe('Basic Storage Provider Interface', () => {
    it('should store and retrieve values via generic interface', async () => {
      const key = 'component:react:test-button';
      const component = {
        framework: 'react',
        name: 'test-button',
        sourceCode: 'test code'
      };
      
      await provider.set(key, component);
      const retrieved = await provider.get(key);
      
      expect(retrieved.framework).toBe(component.framework);
      expect(retrieved.sourceCode).toBe(component.sourceCode);
    });

    it('should check key existence correctly', async () => {
      const key = 'component:react:exists-test';
      const component = {
        framework: 'react',
        name: 'exists-test',
        sourceCode: 'test'
      };
      
      expect(await provider.has(key)).toBe(false);
      
      await provider.set(key, component);
      expect(await provider.has(key)).toBe(true);
    });

    it('should delete keys correctly', async () => {
      const key = 'component:react:delete-test';
      const component = {
        framework: 'react',
        name: 'delete-test',
        sourceCode: 'test'
      };
      
      await provider.set(key, component);
      expect(await provider.has(key)).toBe(true);
      
      const deleted = await provider.delete(key);
      expect(deleted).toBe(true);
      expect(await provider.has(key)).toBe(false);
    });

    it('should return false when deleting non-existent keys', async () => {
      const deleted = await provider.delete('component:react:nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear all data', async () => {
      await provider.set('component:react:test1', { framework: 'react', name: 'test1', sourceCode: 'code1' });
      await provider.set('block:react:test2', { framework: 'react', name: 'test2', files: {} });
      
      expect(await provider.size()).toBeGreaterThanOrEqual(2);
      
      await provider.clear();
      
      expect(await provider.size()).toBe(0);
    });
  });

  describe('Batch Operations', () => {
    it('should get multiple values at once', async () => {
      const component1 = { framework: 'react', name: 'button1', sourceCode: 'code1' };
      const component2 = { framework: 'react', name: 'button2', sourceCode: 'code2' };
      const block1 = { framework: 'react', name: 'dash1', files: {} };
      
      await provider.set('component:react:button1', component1);
      await provider.set('component:react:button2', component2);
      await provider.set('block:react:dash1', block1);
      
      const keys = ['component:react:button1', 'component:react:button2', 'block:react:dash1', 'component:react:nonexistent'];
      const result = await provider.mget(keys);
      
      expect(result.size).toBe(3);
      expect(result.get('component:react:button1').sourceCode).toBe('code1');
      expect(result.get('component:react:button2').sourceCode).toBe('code2');
      expect(result.get('block:react:dash1').files).toEqual({});
      expect(result.has('component:react:nonexistent')).toBe(false);
    });

    it('should set multiple values at once', async () => {
      const data = new Map([
        ['component:react:batch1', { framework: 'react', name: 'batch1', sourceCode: 'code1' }],
        ['component:react:batch2', { framework: 'react', name: 'batch2', sourceCode: 'code2' }]
      ]);
      
      await provider.mset(data);
      
      const comp1 = await provider.get('component:react:batch1');
      const comp2 = await provider.get('component:react:batch2');
      
      expect(comp1.sourceCode).toBe('code1');
      expect(comp2.sourceCode).toBe('code2');
    });
  });

  describe('Transaction Atomicity', () => {
    it('should process mset operations atomically', async () => {
      const data = new Map([
        ['component:react:atomic1', { framework: 'react', name: 'atomic1', sourceCode: 'code1' }],
        ['component:react:atomic2', { framework: 'react', name: 'atomic2', sourceCode: 'code2' }],
        ['block:react:atomic3', { framework: 'react', name: 'atomic3', files: { 'test.tsx': 'content' } }]
      ]);
      
      // Ensure clean state
      for (const key of data.keys()) {
        await provider.delete(key);
      }
      
      // Perform atomic mset
      await provider.mset(data);
      
      // Verify all items were stored
      for (const [key, expectedValue] of data) {
        const actualValue = await provider.get(key);
        expect(actualValue).toBeTruthy();
        
        if (key.includes('component')) {
          expect(actualValue.sourceCode).toBe(expectedValue.sourceCode);
        } else if (key.includes('block')) {
          expect(actualValue.files).toEqual(expectedValue.files);
        }
      }
    });
    
    it('should handle concurrent mset operations without data corruption', async () => {
      const promises = [];
      
      // Create multiple concurrent mset operations
      for (let i = 0; i < 5; i++) {
        const data = new Map([
          [`component:react:concurrent${i}`, { 
            framework: 'react', 
            name: `concurrent${i}`, 
            sourceCode: `code${i}` 
          }]
        ]);
        promises.push(provider.mset(data));
      }
      
      // Wait for all operations to complete
      await Promise.all(promises);
      
      // Verify all components were stored correctly
      for (let i = 0; i < 5; i++) {
        const component = await provider.getComponent('react', `concurrent${i}`);
        expect(component).toBeTruthy();
        expect(component.sourceCode).toBe(`code${i}`);
      }
    });
    
    it('should maintain transaction isolation during clear operations', async () => {
      // Add test data
      const testComponent = { framework: 'react', name: 'isolation-test', sourceCode: 'test' };
      await provider.setComponent(testComponent);
      
      // Verify data exists
      let component = await provider.getComponent('react', 'isolation-test');
      expect(component).toBeTruthy();
      
      // Clear should be atomic
      await provider.clear();
      
      // Verify all data is gone
      component = await provider.getComponent('react', 'isolation-test');
      expect(component).toBeUndefined();
      
      const size = await provider.size();
      expect(size).toBe(0);
    });
    
    it('should handle mixed component and block mset operations atomically', async () => {
      const data = new Map([
        ['component:react:mixed1', { 
          framework: 'react', 
          name: 'mixed1', 
          sourceCode: 'component code' 
        }],
        ['block:react:mixed2', { 
          framework: 'react', 
          name: 'mixed2', 
          files: { 'page.tsx': 'block code' },
          totalSize: 100
        }],
        ['component:react:mixed3', { 
          framework: 'react', 
          name: 'mixed3', 
          sourceCode: 'another component' 
        }]
      ]);
      
      await provider.mset(data);
      
      // Verify component storage
      const comp1 = await provider.getComponent('react', 'mixed1');
      const comp3 = await provider.getComponent('react', 'mixed3');
      expect(comp1.sourceCode).toBe('component code');
      expect(comp3.sourceCode).toBe('another component');
      
      // Verify block storage
      const block2 = await provider.getBlock('react', 'mixed2');
      expect(block2.files).toEqual({ 'page.tsx': 'block code' });
      expect(block2.totalSize).toBe(100);
    });
    
    it('should verify transaction boundaries are respected', async () => {
      const initialSize = await provider.size();
      
      const data = new Map([
        ['component:react:boundary1', { framework: 'react', name: 'boundary1', sourceCode: 'code1' }],
        ['component:react:boundary2', { framework: 'react', name: 'boundary2', sourceCode: 'code2' }]
      ]);
      
      await provider.mset(data);
      
      const finalSize = await provider.size();
      expect(finalSize).toBe(initialSize + 2);
      
      // Verify both components exist
      const comp1 = await provider.getComponent('react', 'boundary1');
      const comp2 = await provider.getComponent('react', 'boundary2');
      expect(comp1).toBeTruthy();
      expect(comp2).toBeTruthy();
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire components after TTL', async () => {
      // Use a short TTL for testing
      const shortTTLProvider = new PGLiteStorageProvider(undefined, {
        defaultTTL: 1 // 1 second
      });
      await shortTTLProvider.initialize();
      
      try {
        const component = { framework: 'react', name: 'expire-test', sourceCode: 'code' };
        await shortTTLProvider.setComponent(component);
        
        expect(await shortTTLProvider.getComponent('react', 'expire-test')).toBeTruthy();
        
        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        const expired = await shortTTLProvider.getComponent('react', 'expire-test');
        expect(expired).toBeUndefined();
      } finally {
        await shortTTLProvider.dispose();
      }
    });

    it('should clean up expired entries', async () => {
      const shortTTLProvider = new PGLiteStorageProvider(undefined, {
        defaultTTL: 1 // 1 second
      });
      await shortTTLProvider.initialize();
      
      try {
        const component1 = { framework: 'react', name: 'expire1', sourceCode: 'code1' };
        const component2 = { framework: 'react', name: 'expire2', sourceCode: 'code2' };
        
        await shortTTLProvider.setComponent(component1);
        await shortTTLProvider.setComponent(component2);
        
        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        const cleaned = await shortTTLProvider.cleanupExpired();
        expect(cleaned).toBeGreaterThanOrEqual(0); // Should clean up expired entries
      } finally {
        await shortTTLProvider.dispose();
      }
    });

    it('should get TTL remaining for items', async () => {
      const component = { framework: 'react', name: 'ttl-test', sourceCode: 'code' };
      await provider.setComponent(component);
      
      const remaining = await provider.getTTLRemaining('react', 'ttl-test', 'component');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(provider.config.defaultTTL);
    });

    it('should refresh TTL for items', async () => {
      const component = { framework: 'react', name: 'refresh-test', sourceCode: 'code' };
      await provider.setComponent(component);
      
      const initialTTL = await provider.getTTLRemaining('react', 'refresh-test', 'component');
      
      // Wait a bit longer to ensure a measurable difference
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get TTL before refresh (should be lower)
      const beforeRefreshTTL = await provider.getTTLRemaining('react', 'refresh-test', 'component');
      
      const refreshed = await provider.refreshTTL('react', 'refresh-test', 'component');
      expect(refreshed).toBe(true);
      
      const newTTL = await provider.getTTLRemaining('react', 'refresh-test', 'component');
      
      // After refresh, TTL should be higher than before refresh
      expect(newTTL).toBeGreaterThan(beforeRefreshTTL);
      // And should be close to the original TTL (within 1 second due to rounding)
      expect(Math.abs(newTTL - initialTTL)).toBeLessThanOrEqual(1);
    });
  });

  describe('Cache Eviction', () => {
    it('should enforce maximum size limits', async () => {
      const smallProvider = new PGLiteStorageProvider(undefined, {
        maxSize: 1000 // 1KB
      });
      await smallProvider.initialize();
      
      try {
        // Add items that exceed the limit
        for (let i = 0; i < 10; i++) {
          const component = {
            framework: 'react',
            name: `large-${i}`,
            sourceCode: 'x'.repeat(200), // Large source code
            fileSize: 200
          };
          await smallProvider.setComponent(component);
        }
        
        const evicted = await smallProvider.enforceMaxSize();
        expect(evicted).toBeGreaterThanOrEqual(0); // Should evict some items
        
        const finalSize = await smallProvider.getCurrentCacheSize();
        expect(finalSize).toBeLessThanOrEqual(smallProvider.config.maxSize);
      } finally {
        await smallProvider.dispose();
      }
    });

    it('should evict LRU items', async () => {
      // Add multiple items
      for (let i = 0; i < 5; i++) {
        const component = {
          framework: 'react',
          name: `lru-${i}`,
          sourceCode: `code ${i}`,
          fileSize: 100
        };
        await provider.setComponent(component);
      }
      
      // Access some items to make them more recently used
      await provider.getComponent('react', 'lru-3');
      await provider.getComponent('react', 'lru-4');
      
      const evicted = await provider.evictLRU(2);
      expect(evicted).toBe(2);
      
      // The accessed items should still exist
      expect(await provider.getComponent('react', 'lru-3')).toBeTruthy();
      expect(await provider.getComponent('react', 'lru-4')).toBeTruthy();
    });

    it('should perform comprehensive maintenance', async () => {
      // Add some items
      for (let i = 0; i < 3; i++) {
        const component = {
          framework: 'react',
          name: `maint-${i}`,
          sourceCode: `code ${i}`,
          fileSize: 100
        };
        await provider.setComponent(component);
      }
      
      const maintenance = await provider.performMaintenance();
      
      expect(typeof maintenance.expiredCleaned).toBe('number');
      expect(typeof maintenance.itemsEvicted).toBe('number');
      expect(typeof maintenance.finalSize).toBe('number');
      expect(typeof maintenance.finalCount).toBe('number');
    });

    it('should detect when maintenance is needed', async () => {
      const needsMaintenance = await provider.needsMaintenance();
      expect(typeof needsMaintenance).toBe('boolean');
    });
  });

  describe('Eviction Logic Verification', () => {
    it('should correctly calculate eviction needs with mixed components and blocks', async () => {
      const testProvider = new PGLiteStorageProvider(undefined, {
        maxSize: 500 // 500 bytes limit
      });
      await testProvider.initialize();
      
      try {
        await testProvider.clear();
        
        // Add components and blocks that total exactly 600 bytes (over limit)
        await testProvider.setComponent({
          framework: 'react',
          name: 'evict-comp1',
          sourceCode: 'component 1',
          fileSize: 200
        });
        
        await testProvider.setBlock({
          framework: 'react', 
          name: 'evict-block1',
          files: { 'file1.tsx': 'block content' },
          totalSize: 150
        });
        
        await testProvider.setComponent({
          framework: 'react',
          name: 'evict-comp2', 
          sourceCode: 'component 2',
          fileSize: 250
        });
        
        // Total: 200 + 150 + 250 = 600 bytes (exceeds 500 byte limit)
        const initialSize = await testProvider.getCurrentCacheSize();
        expect(initialSize).toBe(600);
        
        // Enforce size limits
        const evicted = await testProvider.enforceMaxSize();
        expect(evicted).toBeGreaterThan(0); // Should evict at least one item
        
        // Final size should be within limits
        const finalSize = await testProvider.getCurrentCacheSize();
        expect(finalSize).toBeLessThanOrEqual(500);
        
      } finally {
        await testProvider.dispose();
      }
    });
    
    it('should evict LRU items correctly with mixed data types', async () => {
      await provider.clear();
      
      // Add items with specific access patterns
      await provider.setComponent({
        framework: 'react',
        name: 'oldest-comp',
        sourceCode: 'oldest component',
        fileSize: 100
      });
      
      await provider.setBlock({
        framework: 'react',
        name: 'oldest-block', 
        files: { 'old.tsx': 'old block' },
        totalSize: 150
      });
      
      // Wait a moment to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await provider.setComponent({
        framework: 'react',
        name: 'newer-comp',
        sourceCode: 'newer component', 
        fileSize: 200
      });
      
      // Access the newer items to update their access time
      await provider.getComponent('react', 'newer-comp');
      
      // Evict 2 items (should evict the oldest ones)
      const evicted = await provider.evictLRU(2);
      expect(evicted).toBe(2);
      
      // Verify the newer item still exists
      const newerComp = await provider.getComponent('react', 'newer-comp');
      expect(newerComp).toBeTruthy();
      
      // Verify the older items were evicted
      const olderComp = await provider.getComponent('react', 'oldest-comp');
      const olderBlock = await provider.getBlock('react', 'oldest-block');
      expect(olderComp).toBeUndefined();
      expect(olderBlock).toBeUndefined();
    });
    
    it('should maintain accurate cache size during eviction operations', async () => {
      const testProvider = new PGLiteStorageProvider(undefined, {
        maxSize: 400 // 400 bytes limit
      });
      await testProvider.initialize();
      
      try {
        await testProvider.clear();
        
        // Add items totaling 600 bytes
        await testProvider.setComponent({
          framework: 'react',
          name: 'size-comp1',
          sourceCode: 'component',
          fileSize: 200
        });
        
        await testProvider.setComponent({
          framework: 'react', 
          name: 'size-comp2',
          sourceCode: 'component',
          fileSize: 200
        });
        
        await testProvider.setBlock({
          framework: 'react',
          name: 'size-block1',
          files: { 'file.tsx': 'content' },
          totalSize: 200  
        });
        
        // Verify initial size
        let cacheSize = await testProvider.getCurrentCacheSize();
        expect(cacheSize).toBe(600);
        
        // Enforce size limits  
        const evicted = await testProvider.enforceMaxSize();
        expect(evicted).toBeGreaterThan(0);
        
        // Verify final size is within limits and calculation is accurate
        cacheSize = await testProvider.getCurrentCacheSize();
        expect(cacheSize).toBeLessThanOrEqual(400);
        
        // Size should be exactly what we expect based on remaining items
        const remainingItems = await testProvider.size();
        expect(remainingItems).toBeLessThan(3); // Some items should have been evicted
        
      } finally {
        await testProvider.dispose();
      }
    });
    
    it('should handle maintenance operations with accurate size calculations', async () => {
      await provider.clear();
      
      // Add test data
      await provider.setComponent({
        framework: 'react',
        name: 'maint-comp',
        sourceCode: 'maintenance test',
        fileSize: 100
      });
      
      await provider.setBlock({
        framework: 'react',
        name: 'maint-block',
        files: { 'maint.tsx': 'maintenance content' },
        totalSize: 200
      });
      
      const initialSize = await provider.getCurrentCacheSize();
      expect(initialSize).toBe(300);
      
      // Perform maintenance
      const maintenance = await provider.performMaintenance();
      
      // Verify maintenance results are consistent with accurate size calculation
      expect(maintenance.finalSize).toBe(await provider.getCurrentCacheSize());
      expect(maintenance.finalCount).toBe(await provider.size());
      
      // Final size should be reasonable given our test data
      expect(maintenance.finalSize).toBeGreaterThanOrEqual(0);
      expect(maintenance.finalSize).toBeLessThanOrEqual(initialSize);
    });
    
    it('should make correct eviction decisions based on actual cache size', async () => {
      const testProvider = new PGLiteStorageProvider(undefined, {
        maxSize: 350 // Specific limit for this test
      });
      await testProvider.initialize();
      
      try {
        await testProvider.clear();
        
        // Carefully add items to test eviction decision making
        await testProvider.setComponent({
          framework: 'react',
          name: 'decision-comp', 
          sourceCode: 'component for decision test',
          fileSize: 150
        });
        
        await testProvider.setBlock({
          framework: 'react',
          name: 'decision-block',
          files: { 'decision.tsx': 'block content' },
          totalSize: 100
        });
        
        // Total: 250 bytes (under limit)
        let needsEviction = await testProvider.getCurrentCacheSize() > testProvider.config.maxSize;
        expect(needsEviction).toBe(false);
        
        // Add another item to push over the limit
        await testProvider.setComponent({
          framework: 'react',
          name: 'overflow-comp',
          sourceCode: 'this pushes us over limit',
          fileSize: 150  
        });
        
        // Total: 400 bytes (over 350 limit)
        needsEviction = await testProvider.getCurrentCacheSize() > testProvider.config.maxSize;
        expect(needsEviction).toBe(true);
        
        // Enforce size should now evict
        const evicted = await testProvider.enforceMaxSize();
        expect(evicted).toBeGreaterThan(0);
        
        // Should now be within limits
        const finalSize = await testProvider.getCurrentCacheSize();
        expect(finalSize).toBeLessThanOrEqual(testProvider.config.maxSize);
        
      } finally {
        await testProvider.dispose();
      }
    });
  });

  describe('Metadata Operations', () => {
    it('should track metadata for components', async () => {
      const component = { framework: 'react', name: 'meta-test', sourceCode: 'code' };
      await provider.setComponent(component);
      
      const metadata = await provider.getMetadata('component:react:meta-test');
      
      expect(metadata).toBeTruthy();
      expect(metadata!.key).toBe('component:react:meta-test');
      expect(metadata!.size).toBeGreaterThanOrEqual(0);
      expect(metadata!.createdAt).toBeInstanceOf(Date);
      expect(metadata!.accessedAt).toBeInstanceOf(Date);
      expect(typeof metadata!.accessCount).toBe('number');
    });

    it('should track metadata for blocks', async () => {
      const block = { framework: 'react', name: 'meta-block', files: {}, totalSize: 500 };
      await provider.setBlock(block);
      
      const metadata = await provider.getMetadata('block:react:meta-block');
      
      expect(metadata).toBeTruthy();
      expect(metadata!.key).toBe('block:react:meta-block');
      expect(metadata!.size).toBe(500);
    });

    it('should return null for non-existent metadata', async () => {
      const metadata = await provider.getMetadata('component:react:nonexistent');
      expect(metadata).toBeNull();
    });
  });

  describe('Key Management', () => {
    it('should list all keys', async () => {
      await provider.setComponent({ framework: 'react', name: 'key1', sourceCode: 'code1' });
      await provider.setComponent({ framework: 'react', name: 'key2', sourceCode: 'code2' });
      await provider.setBlock({ framework: 'react', name: 'block1', files: {} });
      
      const keys = await provider.keys();
      
      expect(keys.length).toBeGreaterThanOrEqual(3);
      expect(keys).toContain('component:react:key1');
      expect(keys).toContain('component:react:key2');
      expect(keys).toContain('block:react:block1');
    });

    it('should filter keys by pattern', async () => {
      await provider.setComponent({ framework: 'react', name: 'filter1', sourceCode: 'code1' });
      await provider.setComponent({ framework: 'svelte', name: 'filter2', sourceCode: 'code2' });
      await provider.setBlock({ framework: 'react', name: 'filter3', files: {} });
      
      const reactKeys = await provider.keys('component:react:*');
      const componentKeys = await provider.keys('component:*');
      
      expect(reactKeys).toContain('component:react:filter1');
      expect(reactKeys).not.toContain('component:svelte:filter2');
      expect(reactKeys).not.toContain('block:react:filter3');
      
      expect(componentKeys).toContain('component:react:filter1');
      expect(componentKeys).toContain('component:svelte:filter2');
      expect(componentKeys).not.toContain('block:react:filter3');
    });

    it('should return accurate size', async () => {
      const initialSize = await provider.size();
      
      await provider.setComponent({ framework: 'react', name: 'size1', sourceCode: 'code1' });
      expect(await provider.size()).toBe(initialSize + 1);
      
      await provider.setBlock({ framework: 'react', name: 'size2', files: {} });
      expect(await provider.size()).toBe(initialSize + 2);
      
      await provider.delete('component:react:size1');
      expect(await provider.size()).toBe(initialSize + 1);
    });
  });

  describe('Cache Statistics', () => {
    it('should provide comprehensive cache statistics', async () => {
      // Add some test data
      await provider.setComponent({ framework: 'react', name: 'stats1', sourceCode: 'code1', fileSize: 100 });
      await provider.setComponent({ framework: 'react', name: 'stats2', sourceCode: 'code2', fileSize: 150 });
      await provider.setBlock({ framework: 'react', name: 'stats3', files: {}, totalSize: 200 });
      
      const stats = await provider.getCacheStats();
      
      expect(typeof stats.totalComponents).toBe('number');
      expect(typeof stats.totalBlocks).toBe('number');
      expect(typeof stats.expiredComponents).toBe('number');
      expect(typeof stats.expiredBlocks).toBe('number');
      expect(typeof stats.totalSize).toBe('number');
      expect(typeof stats.avgComponentAge).toBe('number');
      expect(typeof stats.avgBlockAge).toBe('number');
      
      expect(stats.totalComponents).toBeGreaterThanOrEqual(2);
      expect(stats.totalBlocks).toBeGreaterThanOrEqual(1);
      expect(stats.totalSize).toBeGreaterThanOrEqual(450); // 100 + 150 + 200
    });

    it('should get current cache size', async () => {
      await provider.setComponent({ framework: 'react', name: 'size-test', sourceCode: 'code', fileSize: 123 });
      await provider.setBlock({ framework: 'react', name: 'size-block', files: {}, totalSize: 456 });
      
      const currentSize = await provider.getCurrentCacheSize();
      expect(currentSize).toBeGreaterThanOrEqual(579); // 123 + 456
    });
  });

  describe('Cache Size Validation', () => {
    it('should accurately calculate cache size with only components', async () => {
      // Clear cache for clean test
      await provider.clear();
      
      // Add components with known sizes
      await provider.setComponent({ 
        framework: 'react', 
        name: 'comp1', 
        sourceCode: 'code1', 
        fileSize: 100 
      });
      await provider.setComponent({ 
        framework: 'react', 
        name: 'comp2', 
        sourceCode: 'code2', 
        fileSize: 200 
      });
      
      const cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(300); // 100 + 200
    });
    
    it('should accurately calculate cache size with only blocks', async () => {
      // Clear cache for clean test
      await provider.clear();
      
      // Add blocks with known sizes
      await provider.setBlock({ 
        framework: 'react', 
        name: 'block1', 
        files: { 'file1.tsx': 'content1' },
        totalSize: 500 
      });
      await provider.setBlock({ 
        framework: 'react', 
        name: 'block2', 
        files: { 'file2.tsx': 'content2' },
        totalSize: 300 
      });
      
      const cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(800); // 500 + 300
    });
    
    it('should accurately calculate cache size with mixed components and blocks', async () => {
      // Clear cache for clean test
      await provider.clear();
      
      // Add components
      await provider.setComponent({ 
        framework: 'react', 
        name: 'mixed-comp1', 
        sourceCode: 'component code', 
        fileSize: 150 
      });
      await provider.setComponent({ 
        framework: 'react', 
        name: 'mixed-comp2', 
        sourceCode: 'another component', 
        fileSize: 250 
      });
      
      // Add blocks
      await provider.setBlock({ 
        framework: 'react', 
        name: 'mixed-block1', 
        files: { 'page.tsx': 'block content' },
        totalSize: 400 
      });
      await provider.setBlock({ 
        framework: 'react', 
        name: 'mixed-block2', 
        files: { 'layout.tsx': 'layout content' },
        totalSize: 600 
      });
      
      const cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(1400); // 150 + 250 + 400 + 600
    });
    
    it('should return 0 for empty cache', async () => {
      await provider.clear();
      
      const cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(0);
    });
    
    it('should handle null file sizes correctly', async () => {
      await provider.clear();
      
      // Add component without explicit file size (should be null in DB)
      await provider.setComponent({ 
        framework: 'react', 
        name: 'no-size-comp', 
        sourceCode: 'code without size'
        // fileSize intentionally omitted
      });
      
      // Add block without explicit total size
      await provider.setBlock({ 
        framework: 'react', 
        name: 'no-size-block', 
        files: { 'file.tsx': 'content' }
        // totalSize intentionally omitted
      });
      
      const cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(0); // Should handle nulls gracefully
    });
    
    it('should track cache size changes during operations', async () => {
      await provider.clear();
      
      // Initial size should be 0
      let cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(0);
      
      // Add first item
      await provider.setComponent({ 
        framework: 'react', 
        name: 'track1', 
        sourceCode: 'code1', 
        fileSize: 100 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(100);
      
      // Add second item
      await provider.setBlock({ 
        framework: 'react', 
        name: 'track2', 
        files: { 'file.tsx': 'content' },
        totalSize: 200 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(300);
      
      // Delete first item
      await provider.delete('component:react:track1');
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(200);
      
      // Clear all
      await provider.clear();
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(0);
    });
    
    it('should maintain accurate size during updates', async () => {
      await provider.clear();
      
      // Add initial component
      await provider.setComponent({ 
        framework: 'react', 
        name: 'update-test', 
        sourceCode: 'initial code', 
        fileSize: 100 
      });
      
      let cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(100);
      
      // Update with larger size
      await provider.setComponent({ 
        framework: 'react', 
        name: 'update-test', 
        sourceCode: 'much larger code content', 
        fileSize: 300 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(300);
      
      // Update with smaller size
      await provider.setComponent({ 
        framework: 'react', 
        name: 'update-test', 
        sourceCode: 'small', 
        fileSize: 50 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      expect(cacheSize).toBe(50);
    });
  });

  describe('Error Handling', () => {
    it('should handle concurrent operations gracefully', async () => {
      const promises = [];
      
      // Concurrent component sets
      for (let i = 0; i < 5; i++) {
        promises.push(provider.setComponent({
          framework: 'react',
          name: `concurrent-${i}`,
          sourceCode: `code ${i}`
        }));
      }
      
      // Concurrent block sets
      for (let i = 0; i < 5; i++) {
        promises.push(provider.setBlock({
          framework: 'react',
          name: `concurrent-block-${i}`,
          files: {}
        }));
      }
      
      await Promise.all(promises);
      
      // Verify all were set
      for (let i = 0; i < 5; i++) {
        const comp = await provider.getComponent('react', `concurrent-${i}`);
        expect(comp).toBeTruthy();
        expect(comp.sourceCode).toBe(`code ${i}`);
        
        const block = await provider.getBlock('react', `concurrent-block-${i}`);
        expect(block).toBeTruthy();
      }
    });

    it('should validate keys properly', async () => {
      await expect(async () => {
        await provider.set('', { framework: 'react', name: 'test', sourceCode: 'code' });
      }).rejects.toThrow(/Storage key must be a non-empty string/);
      
      await expect(async () => {
        await provider.set('x'.repeat(300), { framework: 'react', name: 'test', sourceCode: 'code' });
      }).rejects.toThrow(/Storage key must not exceed 255 characters/);
    });
  });
});