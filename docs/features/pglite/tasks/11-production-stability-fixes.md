# Task 11: Production Stability Fixes for PGLite Storage Provider

## Priority: 🚨 CRITICAL - BLOCKING PRODUCTION DEPLOYMENT

## Overview
Critical production stability issues have been identified in the PGLite Storage Provider implementation through comprehensive analysis. These issues pose serious risks including memory leaks, data corruption, resource exhaustion, and system crashes under production load. This task addresses all critical and high-priority issues to ensure production readiness.

## Root Cause Analysis

### Critical Issues Identified
1. **Resource Lifecycle Management Missing**: No cleanup mechanism causing memory leaks
2. **Transaction Atomicity Broken**: Nested transactions break data consistency
3. **WASM Concurrency Crashes**: PGLite WASM engine failures under concurrent load
4. **Dual Database Manager Chaos**: Conflicting connection management patterns
5. **Cache Calculation Bugs**: Size reporting errors affecting eviction logic

### Test Failure Symptoms
- "Promise resolution is still pending but the event loop has already resolved"
- "null function or function signature mismatch" (WASM errors)
- Test cancellations due to parent failures
- Async cleanup timeouts

## Phase 1: Critical Resource Leak Fixes

### Priority: 🔥 CRITICAL (Must complete first)
### Timeline: 1-2 days

#### 1.1 Add Disposal Pattern to PGLiteStorageProvider

```typescript
export class PGLiteStorageProvider extends BaseStorageProvider {
  private disposed = false;
  
  /**
   * Properly dispose of database connections and resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    
    this.debug('Disposing PGLite storage provider');
    
    if (this.db) {
      try {
        await this.db.close();
      } catch (error) {
        this.debug(`Error closing database: ${error}`);
      }
      this.db = null;
    }
    
    this.disposed = true;
  }
  
  /**
   * Check if provider has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
  
  /**
   * Guard against operations on disposed provider
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('PGLiteStorageProvider has been disposed and cannot be used');
    }
  }
}
```

#### 1.2 Update Base Class for Disposable Pattern

```typescript
// Add to BaseStorageProvider interface
export interface DisposableStorageProvider extends StorageProvider {
  dispose(): Promise<void>;
  isDisposed(): boolean;
}
```

#### 1.3 Fix Test Resource Management

```typescript
// Update test cleanup patterns
afterEach(async () => {
  if (provider && !provider.isDisposed()) {
    await provider.clear();
    await provider.dispose(); // CRITICAL: Add disposal
  }
});

after(async () => {
  if (dbManager) {
    await dbManager.close();
  }
  await closeDatabase();
});
```

#### 1.4 Add Resource Tracking and Monitoring

```typescript
// Add to PGLiteManager
export class PGLiteManager {
  private static activeConnections = new Set<PGLiteManager>();
  
  constructor(config: DatabaseConfig = {}) {
    super(config);
    PGLiteManager.activeConnections.add(this);
  }
  
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      PGLiteManager.activeConnections.delete(this);
      logger.info('PGLite database closed');
    }
  }
  
  static getActiveConnectionCount(): number {
    return PGLiteManager.activeConnections.size;
  }
  
  static async closeAllConnections(): Promise<void> {
    const promises = Array.from(PGLiteManager.activeConnections).map(manager => 
      manager.close().catch(err => logger.error('Error closing connection:', err))
    );
    await Promise.all(promises);
  }
}
```

## Phase 2: Transaction Atomicity Fixes

### Priority: 🔥 CRITICAL 
### Timeline: 2-3 days

#### 2.1 Fix Broken Batch Operations

**Current Problem**: `mset()` starts a transaction but breaks it by calling `this.set()`

```typescript
// BROKEN IMPLEMENTATION
async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
  await executeTransaction(async (tx) => {
    for (const [key, value] of entries) {
      await this.set(key, value, ttl); // ← Creates NEW transaction!
    }
  });
}
```

**Fixed Implementation**:
```typescript
async mset(entries: Map<string, any>, ttl?: number): Promise<void> {
  return this.wrapOperation(`mset([${entries.size} entries])`, async () => {
    this.ensureNotDisposed();
    
    await executeTransaction(async (tx) => {
      for (const [key, value] of entries) {
        const parsed = this.parseKey(key);
        
        if (parsed.type === 'component' && parsed.framework && parsed.name) {
          await this.setComponentInTransaction(tx, value as Component);
        } else if (parsed.type === 'block' && parsed.framework && parsed.name) {
          await this.setBlockInTransaction(tx, value as Block);
        } else {
          await this.setGenericInTransaction(tx, key, value, ttl);
        }
      }
    });
  });
}
```

#### 2.2 Add Transaction-Aware Methods

```typescript
// Add transaction-aware methods
private async setComponentInTransaction(tx: any, component: Component): Promise<void> {
  const query = `
    INSERT INTO components (
      framework, name, source_code, demo_code, metadata,
      dependencies, registry_dependencies, github_sha,
      file_size, last_modified, cached_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
    ON CONFLICT (framework, name) 
    DO UPDATE SET
      source_code = EXCLUDED.source_code,
      demo_code = EXCLUDED.demo_code,
      metadata = EXCLUDED.metadata,
      dependencies = EXCLUDED.dependencies,
      registry_dependencies = EXCLUDED.registry_dependencies,
      github_sha = EXCLUDED.github_sha,
      file_size = EXCLUDED.file_size,
      last_modified = EXCLUDED.last_modified,
      cached_at = CURRENT_TIMESTAMP,
      access_count = components.access_count + 1
  `;
  
  await tx.query(query, [
    component.framework,
    component.name,
    component.sourceCode,
    component.demoCode,
    component.metadata,
    component.dependencies,
    component.registryDependencies,
    component.githubSha,
    component.fileSize,
    component.lastModified
  ]);
}

private async setBlockInTransaction(tx: any, block: Block): Promise<void> {
  // Similar implementation for blocks...
}
```

#### 2.3 Update Clear Operation

```typescript
async clear(): Promise<void> {
  return this.wrapOperation('clear()', async () => {
    this.ensureNotDisposed();
    
    await executeTransaction(async (tx) => {
      await tx.query('DELETE FROM components');
      await tx.query('DELETE FROM blocks');
      // Add generic storage cleanup when implemented
    });
    
    this.debug('Cleared all storage');
  });
}
```

## Phase 3: WASM Concurrency Control

### Priority: 🔥 CRITICAL
### Timeline: 2-3 days

#### 3.1 Add Async Operation Queue

```typescript
interface QueuedOperation<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class AsyncOperationQueue {
  private queue: QueuedOperation<any>[] = [];
  private running = false;
  
  async add<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.process();
    });
  }
  
  private async process(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    
    this.running = true;
    
    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue.shift()!;
      
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error as Error);
      }
    }
    
    this.running = false;
  }
}
```

#### 3.2 Integrate Queue with Storage Provider

```typescript
export class PGLiteStorageProvider extends BaseStorageProvider {
  private operationQueue = new AsyncOperationQueue();
  
  /**
   * Execute database operation with concurrency control
   */
  private async safeExecute<T>(operation: () => Promise<T>): Promise<T> {
    this.ensureNotDisposed();
    return this.operationQueue.add(operation);
  }
  
  // Update all database operations
  async getComponent(framework: string, name: string): Promise<Component | undefined> {
    return this.safeExecute(async () => {
      // Existing implementation...
    });
  }
  
  async setComponent(component: Component): Promise<void> {
    return this.safeExecute(async () => {
      // Existing implementation...
    });
  }
  
  // Apply to all other database operations...
}
```

#### 3.3 Add Circuit Breaker for WASM Stability

```typescript
export class WASMCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold = 5,
    private recoveryTimeout = 30000 // 30 seconds
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - database operations temporarily disabled');
      }
    }
    
    try {
      const result = await operation();
      
      if (this.state === 'HALF_OPEN') {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  private reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }
}
```

## Phase 4: Database Manager Consolidation

### Priority: ⚠️ HIGH
### Timeline: 3-4 days

#### 4.1 Eliminate Dual Manager Pattern

**Problem**: Tests create both global and local managers
```typescript
// PROBLEMATIC: Creates two different managers for same database
await initializeDatabase({path: testDbPath});  // Global
dbManager = new PGLiteManager({path: testDbPath}); // Local
```

**Solution**: Single manager pattern
```typescript
// Fixed test setup
beforeEach(async () => {
  // Use ONLY the global manager
  await initializeDatabase({
    path: testDbPath,
    maxSizeBytes: 10 * 1024 * 1024
  });
  
  // Don't create a separate manager
  provider = new PGLiteStorageProvider(undefined, {
    maxSize: 1024 * 1024,
    defaultTTL: 60,
    debug: false
  });
  
  await provider.initialize();
  await provider.clear();
});
```

#### 4.2 Add Connection Pool Management

```typescript
export class ConnectionPool {
  private connections: PGlite[] = [];
  private available: PGlite[] = [];
  private maxConnections: number;
  
  constructor(maxConnections = 5) {
    this.maxConnections = maxConnections;
  }
  
  async acquire(): Promise<PGlite> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    
    if (this.connections.length < this.maxConnections) {
      const connection = await this.createConnection();
      this.connections.push(connection);
      return connection;
    }
    
    // Wait for connection to become available
    return new Promise((resolve) => {
      const checkAvailable = () => {
        if (this.available.length > 0) {
          resolve(this.available.pop()!);
        } else {
          setTimeout(checkAvailable, 10);
        }
      };
      checkAvailable();
    });
  }
  
  release(connection: PGlite): void {
    this.available.push(connection);
  }
  
  async closeAll(): Promise<void> {
    await Promise.all(
      this.connections.map(conn => conn.close())
    );
    this.connections = [];
    this.available = [];
  }
}
```

## Phase 5: Fix Cache Size Calculation Bug

### Priority: ⚠️ HIGH
### Timeline: 1 day

#### 5.1 Fix getCurrentCacheSize Query

**Current Broken Implementation**:
```typescript
const query = `
  SELECT 
    COALESCE(SUM(file_size), 0) as component_size
  FROM components
  UNION ALL
  SELECT 
    COALESCE(SUM(total_size), 0) as block_size  -- ← Named block_size
  FROM blocks
`;

const rows = await executeQuery<{component_size: number}>(query);

let totalSize = 0;
for (const row of rows) {
  totalSize += row.component_size || 0;  // ← BUG: Always uses component_size!
}
```

**Fixed Implementation**:
```typescript
async getCurrentCacheSize(): Promise<number> {
  const query = `
    SELECT 
      COALESCE(SUM(file_size), 0) as component_size,
      COALESCE((SELECT SUM(total_size) FROM blocks), 0) as block_size
    FROM components
  `;
  
  const rows = await executeQuery<{component_size: number, block_size: number}>(query);
  
  if (rows.length === 0) {
    return 0;
  }
  
  const row = rows[0];
  return (row.component_size || 0) + (row.block_size || 0);
}
```

#### 5.2 Add Cache Size Validation Tests

```typescript
describe('Cache Size Calculation', () => {
  it('should correctly calculate size with both components and blocks', async () => {
    // Add test component with known size
    await provider.setComponent({
      framework: 'react',
      name: 'size-test-comp',
      sourceCode: 'test',
      fileSize: 100
    });
    
    // Add test block with known size  
    await provider.setBlock({
      framework: 'react',
      name: 'size-test-block',
      files: {},
      totalSize: 200
    });
    
    const totalSize = await provider.getCurrentCacheSize();
    assert.strictEqual(totalSize, 300); // 100 + 200
  });
});
```

## Comprehensive Testing Strategy

### Test Categories Required

#### 5.1 Resource Management Tests
```typescript
describe('Resource Management', () => {
  it('should properly dispose connections', async () => {
    const provider = new PGLiteStorageProvider(dbManager);
    await provider.initialize();
    
    assert.strictEqual(provider.isDisposed(), false);
    await provider.dispose();
    assert.strictEqual(provider.isDisposed(), true);
    
    // Should reject operations after disposal
    await assert.rejects(
      () => provider.get('test:key'),
      /has been disposed/
    );
  });
  
  it('should not leak connections in concurrent scenarios', async () => {
    const initialConnections = PGLiteManager.getActiveConnectionCount();
    
    const providers = [];
    for (let i = 0; i < 10; i++) {
      const provider = new PGLiteStorageProvider(dbManager);
      await provider.initialize();
      providers.push(provider);
    }
    
    // All should be disposed properly
    await Promise.all(providers.map(p => p.dispose()));
    
    const finalConnections = PGLiteManager.getActiveConnectionCount();
    assert.strictEqual(finalConnections, initialConnections);
  });
});
```

#### 5.2 Transaction Atomicity Tests
```typescript
describe('Transaction Atomicity', () => {
  it('should maintain atomicity in batch operations', async () => {
    const entries = new Map([
      ['component:react:test1', {framework: 'react', name: 'test1', sourceCode: 'code1'}],
      ['component:react:test2', {framework: 'react', name: 'test2', sourceCode: 'code2'}]
    ]);
    
    // Simulate failure in middle of batch
    const originalSetComponent = provider.setComponent;
    let callCount = 0;
    provider.setComponent = async (component) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Simulated failure');
      }
      return originalSetComponent.call(provider, component);
    };
    
    await assert.rejects(() => provider.mset(entries));
    
    // Neither component should exist due to rollback
    assert.strictEqual(await provider.has('component:react:test1'), false);
    assert.strictEqual(await provider.has('component:react:test2'), false);
  });
});
```

#### 5.3 Concurrency Control Tests
```typescript
describe('Concurrency Control', () => {
  it('should handle concurrent operations safely', async () => {
    const operations = [];
    
    // Launch many concurrent operations
    for (let i = 0; i < 20; i++) {
      operations.push(
        provider.setComponent({
          framework: 'react',
          name: `concurrent-${i}`,
          sourceCode: `code ${i}`
        })
      );
    }
    
    // All should succeed without WASM errors
    await Promise.all(operations);
    
    // Verify all were written
    for (let i = 0; i < 20; i++) {
      const component = await provider.getComponent('react', `concurrent-${i}`);
      assert.strictEqual(component?.sourceCode, `code ${i}`);
    }
  });
});
```

## Acceptance Criteria

### Critical (Blocking)
- [ ] All resource leaks eliminated (no "Promise resolution pending" errors)
- [ ] WASM stability issues resolved (no "null function signature" errors)
- [ ] Transaction atomicity guaranteed in all batch operations
- [ ] Proper disposal pattern implemented and tested
- [ ] Cache size calculation accuracy verified

### High Priority  
- [ ] Concurrency control prevents WASM crashes
- [ ] Database manager consolidation complete
- [ ] Circuit breaker protects against cascading failures
- [ ] Connection pooling implemented with limits

### Performance
- [ ] No performance regression in core operations
- [ ] Batch operations maintain or improve performance
- [ ] Resource usage stays within acceptable limits

### Testing
- [ ] 100% test pass rate with no flaky tests
- [ ] Resource management tests added
- [ ] Concurrency stress tests passing
- [ ] Transaction atomicity tests comprehensive

## Dependencies
- Task 02: PGLite Database Initialization (completed)
- Task 03: PGLite Storage Provider (completed, needs fixes)

## Estimated Effort
**Total: 8-12 days**
- Phase 1 (Resource Leaks): 1-2 days
- Phase 2 (Transaction Atomicity): 2-3 days  
- Phase 3 (Concurrency Control): 2-3 days
- Phase 4 (Architecture Consolidation): 3-4 days
- Phase 5 (Bug Fixes): 1 day

## Risk Assessment
**Without these fixes**: 
- 🚨 **CRITICAL** - Production deployment will result in system instability
- Memory leaks leading to process crashes
- Data corruption from broken transactions  
- Unpredictable failures under load

**With these fixes**:
- ✅ Production-ready stability
- Predictable resource usage
- Data integrity guaranteed
- Scalable under concurrent load

## Success Metrics
- Zero test failures or timeouts
- No resource leak warnings in test runs
- Stress test handling 100+ concurrent operations
- Memory usage remains stable under load
- All batch operations maintain ACID properties

## Implementation Notes
- **Phase 1 must be completed before any other phases**
- Each phase should be tested in isolation before proceeding
- Consider feature flags for gradual rollout of changes
- Monitor resource usage closely during development
- Document all breaking changes for upgrade path