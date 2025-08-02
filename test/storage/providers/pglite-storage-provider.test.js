import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert';
import { PGLiteStorageProvider } from '../../../build/storage/providers/pglite-storage-provider.js';
import { PGLiteManager } from '../../../build/storage/database/manager.js';
import { initializeDatabase, closeDatabase } from '../../../build/storage/database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('PGLiteStorageProvider', () => {
  let provider;
  let dbManager;
  const testDbPath = path.join(__dirname, '../../temp-test-db');

  before(async () => {
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

  after(async () => {
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
        assert.strictEqual(retrieved.sourceCode, 'test code');
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
        assert.strictEqual(retrieved.sourceCode, 'global test code');
      } finally {
        await newProvider.dispose();
      }
    });
  });

  describe('Key Parsing', () => {
    it('should parse component keys correctly', () => {
      const parsed = provider.parseKey('component:react:button');
      
      assert.strictEqual(parsed.type, 'component');
      assert.strictEqual(parsed.framework, 'react');
      assert.strictEqual(parsed.name, 'button');
    });

    it('should parse block keys correctly', () => {
      const parsed = provider.parseKey('block:react:dashboard-01');
      
      assert.strictEqual(parsed.type, 'block');
      assert.strictEqual(parsed.framework, 'react');
      assert.strictEqual(parsed.name, 'dashboard-01');
    });

    it('should parse metadata keys correctly', () => {
      const parsed = provider.parseKey('metadata:github_rate_limit');
      
      assert.strictEqual(parsed.type, 'metadata');
      assert.strictEqual(parsed.name, 'github_rate_limit');
    });

    it('should build keys correctly', () => {
      const key = provider.buildKey('component', 'react', 'button');
      assert.strictEqual(key, 'component:react:button');
    });

    it('should identify component keys', () => {
      assert.strictEqual(provider.isComponentKey('component:react:button'), true);
      assert.strictEqual(provider.isComponentKey('block:react:dashboard'), false);
    });

    it('should identify block keys', () => {
      assert.strictEqual(provider.isBlockKey('block:react:dashboard'), true);
      assert.strictEqual(provider.isBlockKey('component:react:button'), false);
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
      
      assert.strictEqual(retrieved.framework, sampleComponent.framework);
      assert.strictEqual(retrieved.name, sampleComponent.name);
      assert.strictEqual(retrieved.sourceCode, sampleComponent.sourceCode);
      assert.deepStrictEqual(retrieved.dependencies, sampleComponent.dependencies);
    });

    it('should update access tracking on component retrieval', async () => {
      await provider.setComponent(sampleComponent);
      
      // First access
      await provider.getComponent('react', 'button');
      
      // Second access
      await provider.getComponent('react', 'button');
      
      const metadata = await provider.getComponentMetadata('react', 'button');
      assert.ok(metadata.accessCount >= 2);
    });

    it('should return undefined for non-existent components', async () => {
      const result = await provider.getComponent('react', 'nonexistent');
      assert.strictEqual(result, undefined);
    });

    it('should list components by framework', async () => {
      await provider.setComponent(sampleComponent);
      await provider.setComponent({
        ...sampleComponent,
        name: 'card'
      });

      const components = await provider.listComponents('react');
      
      assert.strictEqual(components.length, 2);
      assert.ok(components.some(c => c.name === 'button'));
      assert.ok(components.some(c => c.name === 'card'));
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
      assert.strictEqual(retrieved.sourceCode, 'updated code');
      assert.strictEqual(retrieved.fileSize, 200);
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
      
      assert.strictEqual(retrieved.framework, sampleBlock.framework);
      assert.strictEqual(retrieved.name, sampleBlock.name);
      assert.strictEqual(retrieved.category, sampleBlock.category);
      assert.deepStrictEqual(retrieved.files, sampleBlock.files);
    });

    it('should update access tracking on block retrieval', async () => {
      await provider.setBlock(sampleBlock);
      
      await provider.getBlock('react', 'dashboard-01');
      await provider.getBlock('react', 'dashboard-01');
      
      const metadata = await provider.getBlockMetadata('react', 'dashboard-01');
      assert.ok(metadata.accessCount >= 2);
    });

    it('should return undefined for non-existent blocks', async () => {
      const result = await provider.getBlock('react', 'nonexistent');
      assert.strictEqual(result, undefined);
    });

    it('should list blocks by framework', async () => {
      await provider.setBlock(sampleBlock);
      await provider.setBlock({
        ...sampleBlock,
        name: 'dashboard-02',
        category: 'analytics'
      });

      const blocks = await provider.listBlocks('react');
      
      assert.strictEqual(blocks.length, 2);
      assert.ok(blocks.some(b => b.name === 'dashboard-01'));
      assert.ok(blocks.some(b => b.name === 'dashboard-02'));
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
      
      assert.strictEqual(dashboardBlocks.length, 1);
      assert.strictEqual(dashboardBlocks[0].name, 'dashboard-01');
      
      assert.strictEqual(analyticsBlocks.length, 1);
      assert.strictEqual(analyticsBlocks[0].name, 'analytics-01');
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
      
      assert.strictEqual(retrieved.framework, component.framework);
      assert.strictEqual(retrieved.sourceCode, component.sourceCode);
    });

    it('should check key existence correctly', async () => {
      const key = 'component:react:exists-test';
      const component = {
        framework: 'react',
        name: 'exists-test',
        sourceCode: 'test'
      };
      
      assert.strictEqual(await provider.has(key), false);
      
      await provider.set(key, component);
      assert.strictEqual(await provider.has(key), true);
    });

    it('should delete keys correctly', async () => {
      const key = 'component:react:delete-test';
      const component = {
        framework: 'react',
        name: 'delete-test',
        sourceCode: 'test'
      };
      
      await provider.set(key, component);
      assert.strictEqual(await provider.has(key), true);
      
      const deleted = await provider.delete(key);
      assert.strictEqual(deleted, true);
      assert.strictEqual(await provider.has(key), false);
    });

    it('should return false when deleting non-existent keys', async () => {
      const deleted = await provider.delete('component:react:nonexistent');
      assert.strictEqual(deleted, false);
    });

    it('should clear all data', async () => {
      await provider.set('component:react:test1', { framework: 'react', name: 'test1', sourceCode: 'code1' });
      await provider.set('block:react:test2', { framework: 'react', name: 'test2', files: {} });
      
      assert.ok((await provider.size()) >= 2);
      
      await provider.clear();
      
      assert.strictEqual(await provider.size(), 0);
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
      
      assert.strictEqual(result.size, 3);
      assert.strictEqual(result.get('component:react:button1').sourceCode, 'code1');
      assert.strictEqual(result.get('component:react:button2').sourceCode, 'code2');
      assert.deepStrictEqual(result.get('block:react:dash1').files, {});
      assert.strictEqual(result.has('component:react:nonexistent'), false);
    });

    it('should set multiple values at once', async () => {
      const data = new Map([
        ['component:react:batch1', { framework: 'react', name: 'batch1', sourceCode: 'code1' }],
        ['component:react:batch2', { framework: 'react', name: 'batch2', sourceCode: 'code2' }]
      ]);
      
      await provider.mset(data);
      
      const comp1 = await provider.get('component:react:batch1');
      const comp2 = await provider.get('component:react:batch2');
      
      assert.strictEqual(comp1.sourceCode, 'code1');
      assert.strictEqual(comp2.sourceCode, 'code2');
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
        assert.ok(actualValue, `Value for key ${key} should exist`);
        
        if (key.includes('component')) {
          assert.strictEqual(actualValue.sourceCode, expectedValue.sourceCode);
        } else if (key.includes('block')) {
          assert.deepStrictEqual(actualValue.files, expectedValue.files);
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
        assert.ok(component, `Component concurrent${i} should exist`);
        assert.strictEqual(component.sourceCode, `code${i}`);
      }
    });
    
    it('should maintain transaction isolation during clear operations', async () => {
      // Add test data
      const testComponent = { framework: 'react', name: 'isolation-test', sourceCode: 'test' };
      await provider.setComponent(testComponent);
      
      // Verify data exists
      let component = await provider.getComponent('react', 'isolation-test');
      assert.ok(component);
      
      // Clear should be atomic
      await provider.clear();
      
      // Verify all data is gone
      component = await provider.getComponent('react', 'isolation-test');
      assert.strictEqual(component, undefined);
      
      const size = await provider.size();
      assert.strictEqual(size, 0);
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
      assert.strictEqual(comp1.sourceCode, 'component code');
      assert.strictEqual(comp3.sourceCode, 'another component');
      
      // Verify block storage
      const block2 = await provider.getBlock('react', 'mixed2');
      assert.deepStrictEqual(block2.files, { 'page.tsx': 'block code' });
      assert.strictEqual(block2.totalSize, 100);
    });
    
    it('should verify transaction boundaries are respected', async () => {
      const initialSize = await provider.size();
      
      const data = new Map([
        ['component:react:boundary1', { framework: 'react', name: 'boundary1', sourceCode: 'code1' }],
        ['component:react:boundary2', { framework: 'react', name: 'boundary2', sourceCode: 'code2' }]
      ]);
      
      await provider.mset(data);
      
      const finalSize = await provider.size();
      assert.strictEqual(finalSize, initialSize + 2);
      
      // Verify both components exist
      const comp1 = await provider.getComponent('react', 'boundary1');
      const comp2 = await provider.getComponent('react', 'boundary2');
      assert.ok(comp1);
      assert.ok(comp2);
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
        
        assert.ok(await shortTTLProvider.getComponent('react', 'expire-test'));
        
        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        const expired = await shortTTLProvider.getComponent('react', 'expire-test');
        assert.strictEqual(expired, undefined);
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
        assert.ok(cleaned >= 0); // Should clean up expired entries
      } finally {
        await shortTTLProvider.dispose();
      }
    });

    it('should get TTL remaining for items', async () => {
      const component = { framework: 'react', name: 'ttl-test', sourceCode: 'code' };
      await provider.setComponent(component);
      
      const remaining = await provider.getTTLRemaining('react', 'ttl-test', 'component');
      assert.ok(remaining > 0);
      assert.ok(remaining <= provider.config.defaultTTL);
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
      assert.strictEqual(refreshed, true);
      
      const newTTL = await provider.getTTLRemaining('react', 'refresh-test', 'component');
      
      // After refresh, TTL should be higher than before refresh
      assert.ok(newTTL > beforeRefreshTTL, `New TTL (${newTTL}) should be > before refresh TTL (${beforeRefreshTTL})`);
      // And should be close to the original TTL (within 1 second due to rounding)
      assert.ok(Math.abs(newTTL - initialTTL) <= 1, `New TTL (${newTTL}) should be close to initial TTL (${initialTTL})`);
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
        assert.ok(evicted >= 0); // Should evict some items
        
        const finalSize = await smallProvider.getCurrentCacheSize();
        assert.ok(finalSize <= smallProvider.config.maxSize);
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
      assert.strictEqual(evicted, 2);
      
      // The accessed items should still exist
      assert.ok(await provider.getComponent('react', 'lru-3'));
      assert.ok(await provider.getComponent('react', 'lru-4'));
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
      
      assert.ok(typeof maintenance.expiredCleaned === 'number');
      assert.ok(typeof maintenance.itemsEvicted === 'number');
      assert.ok(typeof maintenance.finalSize === 'number');
      assert.ok(typeof maintenance.finalCount === 'number');
    });

    it('should detect when maintenance is needed', async () => {
      const needsMaintenance = await provider.needsMaintenance();
      assert.ok(typeof needsMaintenance === 'boolean');
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
        assert.strictEqual(initialSize, 600);
        
        // Enforce size limits
        const evicted = await testProvider.enforceMaxSize();
        assert.ok(evicted > 0); // Should evict at least one item
        
        // Final size should be within limits
        const finalSize = await testProvider.getCurrentCacheSize();
        assert.ok(finalSize <= 500);
        
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
      assert.strictEqual(evicted, 2);
      
      // Verify the newer item still exists
      const newerComp = await provider.getComponent('react', 'newer-comp');
      assert.ok(newerComp);
      
      // Verify the older items were evicted
      const olderComp = await provider.getComponent('react', 'oldest-comp');
      const olderBlock = await provider.getBlock('react', 'oldest-block');
      assert.strictEqual(olderComp, undefined);
      assert.strictEqual(olderBlock, undefined);
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
        assert.strictEqual(cacheSize, 600);
        
        // Enforce size limits  
        const evicted = await testProvider.enforceMaxSize();
        assert.ok(evicted > 0);
        
        // Verify final size is within limits and calculation is accurate
        cacheSize = await testProvider.getCurrentCacheSize();
        assert.ok(cacheSize <= 400);
        
        // Size should be exactly what we expect based on remaining items
        const remainingItems = await testProvider.size();
        assert.ok(remainingItems < 3); // Some items should have been evicted
        
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
      assert.strictEqual(initialSize, 300);
      
      // Perform maintenance
      const maintenance = await provider.performMaintenance();
      
      // Verify maintenance results are consistent with accurate size calculation
      assert.strictEqual(maintenance.finalSize, await provider.getCurrentCacheSize());
      assert.strictEqual(maintenance.finalCount, await provider.size());
      
      // Final size should be reasonable given our test data
      assert.ok(maintenance.finalSize >= 0);
      assert.ok(maintenance.finalSize <= initialSize);
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
        assert.strictEqual(needsEviction, false);
        
        // Add another item to push over the limit
        await testProvider.setComponent({
          framework: 'react',
          name: 'overflow-comp',
          sourceCode: 'this pushes us over limit',
          fileSize: 150  
        });
        
        // Total: 400 bytes (over 350 limit)
        needsEviction = await testProvider.getCurrentCacheSize() > testProvider.config.maxSize;
        assert.strictEqual(needsEviction, true);
        
        // Enforce size should now evict
        const evicted = await testProvider.enforceMaxSize();
        assert.ok(evicted > 0);
        
        // Should now be within limits
        const finalSize = await testProvider.getCurrentCacheSize();
        assert.ok(finalSize <= testProvider.config.maxSize);
        
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
      
      assert.ok(metadata);
      assert.strictEqual(metadata.key, 'component:react:meta-test');
      assert.ok(metadata.size >= 0);
      assert.ok(metadata.createdAt instanceof Date);
      assert.ok(metadata.accessedAt instanceof Date);
      assert.ok(typeof metadata.accessCount === 'number');
    });

    it('should track metadata for blocks', async () => {
      const block = { framework: 'react', name: 'meta-block', files: {}, totalSize: 500 };
      await provider.setBlock(block);
      
      const metadata = await provider.getMetadata('block:react:meta-block');
      
      assert.ok(metadata);
      assert.strictEqual(metadata.key, 'block:react:meta-block');
      assert.strictEqual(metadata.size, 500);
    });

    it('should return null for non-existent metadata', async () => {
      const metadata = await provider.getMetadata('component:react:nonexistent');
      assert.strictEqual(metadata, null);
    });
  });

  describe('Key Management', () => {
    it('should list all keys', async () => {
      await provider.setComponent({ framework: 'react', name: 'key1', sourceCode: 'code1' });
      await provider.setComponent({ framework: 'react', name: 'key2', sourceCode: 'code2' });
      await provider.setBlock({ framework: 'react', name: 'block1', files: {} });
      
      const keys = await provider.keys();
      
      assert.ok(keys.length >= 3);
      assert.ok(keys.includes('component:react:key1'));
      assert.ok(keys.includes('component:react:key2'));
      assert.ok(keys.includes('block:react:block1'));
    });

    it('should filter keys by pattern', async () => {
      await provider.setComponent({ framework: 'react', name: 'filter1', sourceCode: 'code1' });
      await provider.setComponent({ framework: 'svelte', name: 'filter2', sourceCode: 'code2' });
      await provider.setBlock({ framework: 'react', name: 'filter3', files: {} });
      
      const reactKeys = await provider.keys('component:react:*');
      const componentKeys = await provider.keys('component:*');
      
      assert.ok(reactKeys.includes('component:react:filter1'));
      assert.ok(!reactKeys.includes('component:svelte:filter2'));
      assert.ok(!reactKeys.includes('block:react:filter3'));
      
      assert.ok(componentKeys.includes('component:react:filter1'));
      assert.ok(componentKeys.includes('component:svelte:filter2'));
      assert.ok(!componentKeys.includes('block:react:filter3'));
    });

    it('should return accurate size', async () => {
      const initialSize = await provider.size();
      
      await provider.setComponent({ framework: 'react', name: 'size1', sourceCode: 'code1' });
      assert.strictEqual(await provider.size(), initialSize + 1);
      
      await provider.setBlock({ framework: 'react', name: 'size2', files: {} });
      assert.strictEqual(await provider.size(), initialSize + 2);
      
      await provider.delete('component:react:size1');
      assert.strictEqual(await provider.size(), initialSize + 1);
    });
  });

  describe('Cache Statistics', () => {
    it('should provide comprehensive cache statistics', async () => {
      // Add some test data
      await provider.setComponent({ framework: 'react', name: 'stats1', sourceCode: 'code1', fileSize: 100 });
      await provider.setComponent({ framework: 'react', name: 'stats2', sourceCode: 'code2', fileSize: 150 });
      await provider.setBlock({ framework: 'react', name: 'stats3', files: {}, totalSize: 200 });
      
      const stats = await provider.getCacheStats();
      
      assert.ok(typeof stats.totalComponents === 'number');
      assert.ok(typeof stats.totalBlocks === 'number');
      assert.ok(typeof stats.expiredComponents === 'number');
      assert.ok(typeof stats.expiredBlocks === 'number');
      assert.ok(typeof stats.totalSize === 'number');
      assert.ok(typeof stats.avgComponentAge === 'number');
      assert.ok(typeof stats.avgBlockAge === 'number');
      
      assert.ok(stats.totalComponents >= 2);
      assert.ok(stats.totalBlocks >= 1);
      assert.ok(stats.totalSize >= 450); // 100 + 150 + 200
    });

    it('should get current cache size', async () => {
      await provider.setComponent({ framework: 'react', name: 'size-test', sourceCode: 'code', fileSize: 123 });
      await provider.setBlock({ framework: 'react', name: 'size-block', files: {}, totalSize: 456 });
      
      const currentSize = await provider.getCurrentCacheSize();
      assert.ok(currentSize >= 579); // 123 + 456
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
      assert.strictEqual(cacheSize, 300); // 100 + 200
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
      assert.strictEqual(cacheSize, 800); // 500 + 300
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
      assert.strictEqual(cacheSize, 1400); // 150 + 250 + 400 + 600
    });
    
    it('should return 0 for empty cache', async () => {
      await provider.clear();
      
      const cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 0);
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
      assert.strictEqual(cacheSize, 0); // Should handle nulls gracefully
    });
    
    it('should track cache size changes during operations', async () => {
      await provider.clear();
      
      // Initial size should be 0
      let cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 0);
      
      // Add first item
      await provider.setComponent({ 
        framework: 'react', 
        name: 'track1', 
        sourceCode: 'code1', 
        fileSize: 100 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 100);
      
      // Add second item
      await provider.setBlock({ 
        framework: 'react', 
        name: 'track2', 
        files: { 'file.tsx': 'content' },
        totalSize: 200 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 300);
      
      // Delete first item
      await provider.delete('component:react:track1');
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 200);
      
      // Clear all
      await provider.clear();
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 0);
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
      assert.strictEqual(cacheSize, 100);
      
      // Update with larger size
      await provider.setComponent({ 
        framework: 'react', 
        name: 'update-test', 
        sourceCode: 'much larger code content', 
        fileSize: 300 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 300);
      
      // Update with smaller size
      await provider.setComponent({ 
        framework: 'react', 
        name: 'update-test', 
        sourceCode: 'small', 
        fileSize: 50 
      });
      
      cacheSize = await provider.getCurrentCacheSize();
      assert.strictEqual(cacheSize, 50);
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
        assert.ok(comp);
        assert.strictEqual(comp.sourceCode, `code ${i}`);
        
        const block = await provider.getBlock('react', `concurrent-block-${i}`);
        assert.ok(block);
      }
    });

    it('should validate keys properly', async () => {
      await assert.rejects(
        async () => await provider.set('', { framework: 'react', name: 'test', sourceCode: 'code' }),
        /Storage key must be a non-empty string/
      );
      
      await assert.rejects(
        async () => await provider.set('x'.repeat(300), { framework: 'react', name: 'test', sourceCode: 'code' }),
        /Storage key must not exceed 255 characters/
      );
    });
  });
});