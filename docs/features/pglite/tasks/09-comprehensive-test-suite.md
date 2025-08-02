# Task 09: Comprehensive Test Suite

## Overview
Create a comprehensive test suite for the PGLite storage implementation covering unit tests, integration tests, performance tests, and end-to-end scenarios. This ensures reliability, performance, and maintainability of the cache system.

## Objectives
- Achieve 90%+ code coverage
- Test all storage providers independently
- Verify hybrid storage orchestration
- Performance benchmarking
- Error scenario coverage
- Mock external dependencies
- Test concurrent operations

## Technical Requirements

### Test Structure
```typescript
// Test categories
interface TestSuite {
  unit: {
    providers: StorageProviderTests;
    database: DatabaseTests;
    configuration: ConfigurationTests;
    utils: UtilityTests;
  };
  integration: {
    hybrid: HybridStorageTests;
    migration: MigrationTests;
    cli: CLITests;
    monitoring: MonitoringTests;
  };
  performance: {
    benchmarks: BenchmarkTests;
    stress: StressTests;
    memory: MemoryLeakTests;
  };
  e2e: {
    scenarios: ScenarioTests;
    realWorld: RealWorldTests;
  };
}
```

### Unit Tests

#### Storage Provider Tests
```typescript
// src/__tests__/unit/providers/memory-storage.test.ts
describe('MemoryStorageProvider', () => {
  let provider: MemoryStorageProvider;
  
  beforeEach(() => {
    provider = new MemoryStorageProvider({
      maxSize: 1024 * 1024, // 1MB
      ttl: 3600
    });
  });
  
  describe('basic operations', () => {
    it('should store and retrieve values', async () => {
      await provider.set('test-key', { data: 'test' });
      const value = await provider.get('test-key');
      expect(value).toEqual({ data: 'test' });
    });
    
    it('should return undefined for missing keys', async () => {
      const value = await provider.get('missing-key');
      expect(value).toBeUndefined();
    });
    
    it('should delete values', async () => {
      await provider.set('test-key', 'value');
      const deleted = await provider.delete('test-key');
      expect(deleted).toBe(true);
      expect(await provider.has('test-key')).toBe(false);
    });
  });
  
  describe('TTL handling', () => {
    it('should expire values after TTL', async () => {
      jest.useFakeTimers();
      
      await provider.set('ttl-key', 'value', 1000); // 1 second
      expect(await provider.get('ttl-key')).toBe('value');
      
      jest.advanceTimersByTime(1001);
      expect(await provider.get('ttl-key')).toBeUndefined();
      
      jest.useRealTimers();
    });
    
    it('should use default TTL when not specified', async () => {
      const spy = jest.spyOn(provider as any, 'scheduleExpiration');
      await provider.set('key', 'value');
      expect(spy).toHaveBeenCalledWith('key', 3600);
    });
  });
  
  describe('size limits', () => {
    it('should enforce size limits', async () => {
      const largeData = 'x'.repeat(2 * 1024 * 1024); // 2MB
      await expect(provider.set('large', largeData))
        .rejects.toThrow('Storage limit exceeded');
    });
    
    it('should evict old items when size limit reached', async () => {
      // Fill cache
      for (let i = 0; i < 100; i++) {
        await provider.set(`key-${i}`, 'x'.repeat(10 * 1024)); // 10KB each
      }
      
      // Verify oldest items were evicted
      expect(await provider.has('key-0')).toBe(false);
      expect(await provider.has('key-99')).toBe(true);
    });
  });
  
  describe('batch operations', () => {
    it('should handle batch get operations', async () => {
      await provider.set('key1', 'value1');
      await provider.set('key2', 'value2');
      
      const results = await provider.mget(['key1', 'key2', 'key3']);
      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
      expect(results.has('key3')).toBe(false);
    });
  });
});
```

#### PGLite Storage Tests
```typescript
// src/__tests__/unit/providers/pglite-storage.test.ts
describe('PGLiteStorageProvider', () => {
  let provider: PGLiteStorageProvider;
  let dbManager: PGLiteManager;
  let mockDb: MockPGLite;
  
  beforeEach(async () => {
    mockDb = new MockPGLite();
    dbManager = {
      getConnection: jest.fn().mockResolvedValue(mockDb)
    };
    
    provider = new PGLiteStorageProvider(dbManager);
    await provider.initialize();
  });
  
  describe('component operations', () => {
    it('should store components correctly', async () => {
      const component = {
        framework: 'react',
        name: 'button',
        sourceCode: 'export default Button',
        demoCode: '<Button />',
        metadata: { version: '1.0' }
      };
      
      await provider.set('component:react:button', component);
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO components'),
        expect.arrayContaining(['react', 'button'])
      );
    });
    
    it('should handle component retrieval with access tracking', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{
          framework: 'react',
          name: 'button',
          source_code: 'code',
          access_count: 5
        }]
      });
      
      const result = await provider.get('component:react:button');
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE components'),
        expect.arrayContaining(['react', 'button'])
      );
      expect(result.framework).toBe('react');
    });
  });
  
  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDb.query.mockRejectedValue(new Error('Database error'));
      
      await expect(provider.get('test-key'))
        .rejects.toThrow('Failed to get from PGLite');
    });
    
    it('should rollback transactions on error', async () => {
      mockDb.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Insert failed')); // INSERT
      
      await expect(provider.set('key', 'value'))
        .rejects.toThrow();
      
      expect(mockDb.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
```

### Integration Tests

#### Hybrid Storage Tests
```typescript
// src/__tests__/integration/hybrid-storage.test.ts
describe('HybridStorage Integration', () => {
  let hybrid: HybridStorage;
  let memoryProvider: MemoryStorageProvider;
  let pgliteProvider: PGLiteStorageProvider;
  let githubProvider: GitHubStorageProvider;
  
  beforeEach(async () => {
    // Setup real providers with test database
    const testDb = await createTestDatabase();
    
    memoryProvider = new MemoryStorageProvider({ maxSize: 1024 * 1024 });
    pgliteProvider = new PGLiteStorageProvider(testDb);
    githubProvider = new MockGitHubProvider();
    
    hybrid = new HybridStorage({
      providers: { memory: memoryProvider, pglite: pgliteProvider, github: githubProvider },
      strategy: CacheStrategy.READ_THROUGH
    });
  });
  
  afterEach(async () => {
    await cleanupTestDatabase();
  });
  
  describe('tiered caching', () => {
    it('should check tiers in order', async () => {
      const memorySpy = jest.spyOn(memoryProvider, 'get');
      const pgliteSpy = jest.spyOn(pgliteProvider, 'get');
      const githubSpy = jest.spyOn(githubProvider, 'get');
      
      // Only in GitHub
      githubProvider.setMockData('component:react:button', { code: 'test' });
      
      const result = await hybrid.get('component:react:button');
      
      expect(memorySpy).toHaveBeenCalledBefore(pgliteSpy);
      expect(pgliteSpy).toHaveBeenCalledBefore(githubSpy);
      expect(result).toEqual({ code: 'test' });
    });
    
    it('should promote data to higher tiers', async () => {
      // Data only in PGLite
      await pgliteProvider.set('component:react:card', { code: 'card' });
      
      const result = await hybrid.get('component:react:card');
      
      // Should now be in memory
      expect(await memoryProvider.has('component:react:card')).toBe(true);
    });
  });
  
  describe('circuit breaker', () => {
    it('should open circuit after failures', async () => {
      // Simulate GitHub API failures
      for (let i = 0; i < 5; i++) {
        githubProvider.simulateError();
        await hybrid.get(`test-${i}`).catch(() => {});
      }
      
      // Circuit should be open
      githubProvider.setMockData('test-key', 'value');
      const result = await hybrid.get('test-key');
      
      expect(result).toBeUndefined();
      expect(githubProvider.get).not.toHaveBeenCalledWith('test-key');
    });
  });
});
```

#### Migration Tests
```typescript
// src/__tests__/integration/migration.test.ts
describe('Cache Migration', () => {
  let migrator: CacheMigrationManager;
  let sourceCache: Map<string, any>;
  let targetDb: PGLite;
  
  beforeEach(async () => {
    // Create source cache with test data
    sourceCache = new Map([
      ['component:react:button', { 
        sourceCode: 'export Button', 
        cachedAt: new Date('2024-01-01') 
      }],
      ['block:react:dashboard', {
        files: { 'index.tsx': 'dashboard code' },
        category: 'dashboards'
      }]
    ]);
    
    // Mock file system to return our cache
    jest.spyOn(fs, 'readFile').mockResolvedValue(
      JSON.stringify(Array.from(sourceCache.entries()))
    );
    
    targetDb = await createTestDatabase();
    migrator = new CacheMigrationManager({
      targetPath: ':memory:',
      dryRun: false
    });
  });
  
  it('should migrate all cache entries', async () => {
    const result = await migrator.migrate();
    
    expect(result.status).toBe('success');
    expect(result.itemsMigrated).toBe(2);
    
    // Verify data in target database
    const components = await targetDb.query(
      'SELECT * FROM components WHERE name = $1',
      ['button']
    );
    expect(components.rows).toHaveLength(1);
    expect(components.rows[0].source_code).toBe('export Button');
  });
  
  it('should handle migration failures gracefully', async () => {
    // Corrupt one entry
    sourceCache.set('invalid:key', { corrupt: Symbol('bad') });
    
    const result = await migrator.migrate();
    
    expect(result.status).toBe('partial');
    expect(result.itemsMigrated).toBe(2);
    expect(result.itemsFailed).toBe(1);
  });
});
```

### Performance Tests

#### Benchmark Tests
```typescript
// src/__tests__/performance/benchmarks.test.ts
describe('Performance Benchmarks', () => {
  let hybrid: HybridStorage;
  
  beforeEach(async () => {
    hybrid = await createProductionLikeHybridStorage();
  });
  
  it('should meet response time SLAs', async () => {
    const iterations = 1000;
    const results: number[] = [];
    
    // Warm up cache
    await hybrid.get('component:react:button');
    
    // Measure response times
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await hybrid.get('component:react:button');
      const end = process.hrtime.bigint();
      
      results.push(Number(end - start) / 1_000_000); // Convert to ms
    }
    
    const p50 = percentile(results, 50);
    const p95 = percentile(results, 95);
    const p99 = percentile(results, 99);
    
    expect(p50).toBeLessThan(5);    // 50th percentile < 5ms
    expect(p95).toBeLessThan(10);   // 95th percentile < 10ms
    expect(p99).toBeLessThan(20);   // 99th percentile < 20ms
  });
  
  it('should handle concurrent operations efficiently', async () => {
    const concurrency = 100;
    const operations = 1000;
    
    const start = Date.now();
    
    const promises = Array(operations).fill(0).map((_, i) => 
      hybrid.get(`component:react:test-${i % concurrency}`)
    );
    
    await Promise.all(promises);
    
    const duration = Date.now() - start;
    const opsPerSecond = operations / (duration / 1000);
    
    expect(opsPerSecond).toBeGreaterThan(1000); // >1000 ops/sec
  });
});

// Stress tests
describe('Stress Tests', () => {
  it('should handle large datasets', async () => {
    const storage = await createHybridStorage();
    
    // Insert 10,000 components
    for (let i = 0; i < 10000; i++) {
      await storage.set(`component:test:comp-${i}`, {
        code: `Component ${i}`,
        size: 1024 * Math.random() * 10 // 0-10KB
      });
    }
    
    // Random access pattern
    const accessStart = Date.now();
    for (let i = 0; i < 1000; i++) {
      const id = Math.floor(Math.random() * 10000);
      await storage.get(`component:test:comp-${id}`);
    }
    const accessDuration = Date.now() - accessStart;
    
    expect(accessDuration).toBeLessThan(5000); // <5 seconds for 1000 reads
  });
});
```

### End-to-End Tests

#### Scenario Tests
```typescript
// src/__tests__/e2e/scenarios.test.ts
describe('E2E Scenarios', () => {
  let server: MCPServer;
  
  beforeEach(async () => {
    server = await createTestServer({
      storage: { type: 'hybrid' },
      features: { migration: true }
    });
  });
  
  it('should handle complete user workflow', async () => {
    // 1. Fresh start - no cache
    const stats1 = await server.getCacheStats();
    expect(stats1.components.total).toBe(0);
    
    // 2. Fetch component (cache miss)
    const button = await server.getComponent('react', 'button');
    expect(button.sourceCode).toBeDefined();
    
    // 3. Verify cached
    const stats2 = await server.getCacheStats();
    expect(stats2.components.total).toBe(1);
    expect(stats2.cache.hitRate).toBe(0); // First fetch was a miss
    
    // 4. Fetch again (cache hit)
    const button2 = await server.getComponent('react', 'button');
    expect(button2).toEqual(button);
    
    // 5. Check improved hit rate
    const stats3 = await server.getCacheStats();
    expect(stats3.cache.hitRate).toBeGreaterThan(0);
    
    // 6. Clear cache
    await server.clearCache({ type: 'components' });
    
    // 7. Verify cleared
    const stats4 = await server.getCacheStats();
    expect(stats4.components.total).toBe(0);
  });
  
  it('should work in offline mode', async () => {
    // Populate cache
    await server.getComponent('react', 'button');
    await server.getComponent('react', 'card');
    
    // Enable offline mode
    await server.setOfflineMode(true);
    
    // Should work from cache
    const button = await server.getComponent('react', 'button');
    expect(button).toBeDefined();
    
    // Should fail for uncached items
    await expect(server.getComponent('react', 'dialog'))
      .rejects.toThrow('Offline mode: component not in cache');
  });
});
```

### Test Utilities

#### Mock Providers
```typescript
// src/__tests__/utils/mocks.ts
export class MockGitHubProvider implements StorageProvider {
  private data = new Map<string, any>();
  private shouldError = false;
  
  setMockData(key: string, value: any) {
    this.data.set(key, value);
  }
  
  simulateError() {
    this.shouldError = true;
  }
  
  async get(key: string): Promise<any> {
    if (this.shouldError) {
      this.shouldError = false;
      throw new Error('GitHub API error');
    }
    
    // Simulate network delay
    await delay(50 + Math.random() * 50);
    
    return this.data.get(key);
  }
}

export async function createTestDatabase(): Promise<PGLite> {
  const db = new PGLite(':memory:');
  
  // Initialize schema
  const schema = await fs.readFile(
    path.join(__dirname, '../../storage/schemas/001_initial_schema.sql'),
    'utf-8'
  );
  
  await db.exec(schema);
  
  return db;
}
```

### Test Configuration
```typescript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  testMatch: [
    '**/__tests__/**/*.test.ts'
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 30000,
  maxWorkers: '50%'
};
```

### Continuous Integration
```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
        test-type: [unit, integration, performance, e2e]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run ${{ matrix.test-type }} tests
      run: npm run test:${{ matrix.test-type }}
    
    - name: Upload coverage
      if: matrix.test-type == 'unit'
      uses: codecov/codecov-action@v3
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/__tests__/
   ├── unit/
   │   ├── providers/
   │   ├── database/
   │   └── utils/
   ├── integration/
   ├── performance/
   ├── e2e/
   ├── utils/
   │   ├── mocks.ts
   │   └── helpers.ts
   └── setup.ts
   ```

2. **Test Data Management**:
   - Fixtures for consistent test data
   - Factories for generating test objects
   - Cleanup utilities

3. **Performance Metrics**:
   - Response time percentiles
   - Throughput measurements
   - Memory usage tracking

### Acceptance Criteria
- [ ] 90%+ code coverage achieved
- [ ] All unit tests pass
- [ ] Integration tests verify component interactions
- [ ] Performance benchmarks meet SLAs
- [ ] E2E tests cover critical user paths
- [ ] CI/CD pipeline runs all tests
- [ ] Test documentation complete

### Testing Requirements
- Mock external dependencies
- Test database isolation
- Concurrent test execution
- Performance regression detection
- Memory leak detection
- Coverage reporting

### Dependencies
- npm packages: jest, @types/jest, ts-jest
- Testing utilities: supertest, nock
- Performance tools: benchmark

### Estimated Effort
- 5-6 days

### Notes
- Consider adding visual regression tests for UI components
- Add contract tests for GitHub API integration
- Implement chaos testing for resilience
- Document test best practices