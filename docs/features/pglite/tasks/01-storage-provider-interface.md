# Task 01: Storage Provider Interface and Base Implementation

## Overview
Create a flexible storage provider interface that allows the MCP server to use different storage backends (memory, PGLite, GitHub API) interchangeably. This establishes the foundation for the hybrid storage architecture.

## Objectives
- Define a common interface for all storage providers
- Create base abstract class with shared functionality
- Implement in-memory storage provider
- Add proper TypeScript types and error handling

## Technical Requirements

### Storage Provider Interface
```typescript
interface StorageProvider {
  // Core operations
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  
  // Batch operations
  mget(keys: string[]): Promise<Map<string, any>>;
  mset(entries: Map<string, any>, ttl?: number): Promise<void>;
  
  // Metadata operations
  getMetadata(key: string): Promise<StorageMetadata | null>;
  keys(pattern?: string): Promise<string[]>;
  size(): Promise<number>;
}

interface StorageMetadata {
  key: string;
  size: number;
  ttl?: number;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  accessCount: number;
}
```

### Implementation Details

1. **Create base directory structure**:
   ```
   src/storage/
   ├── interfaces/
   │   └── storage-provider.ts
   ├── providers/
   │   ├── base-storage-provider.ts
   │   └── memory-storage-provider.ts
   └── index.ts
   ```

2. **Base Storage Provider**:
   - Abstract class implementing common functionality
   - TTL management logic
   - Key validation
   - Error handling wrappers
   - Logging integration

3. **Memory Storage Provider**:
   - Adapter wrapper around existing `Cache` class from `src/utils/cache.ts`
   - Add metadata tracking layer on top
   - Implement missing StorageProvider methods (batch operations, metadata)
   - Preserve existing cache functionality while extending it
   - Future option: gradually migrate Cache class features into provider

### Acceptance Criteria
- [ ] Storage provider interface is well-defined with JSDoc comments
- [ ] Base abstract class implements shared functionality
- [ ] Memory storage provider passes all interface tests
- [ ] 100% test coverage for memory provider
- [ ] TypeScript strict mode compliance
- [ ] Error handling for edge cases (null values, expired TTLs, etc.)

### Testing Requirements
- Unit tests for each provider method
- TTL expiration tests
- Concurrent access tests
- Memory limit tests
- Error scenario tests

### Dependencies
- None (this is the foundation task)

### Estimated Effort
- 2-3 days

### Example Usage
```typescript
import { MemoryStorageProvider } from './storage/providers/memory-storage-provider';
import { cache } from '../../utils/cache';

const storage = new MemoryStorageProvider({
  maxSize: 100 * 1024 * 1024, // 100MB
  defaultTTL: 3600 // 1 hour
});

// Basic operations
await storage.set('component:button', { code: '...' }, 7200);
const component = await storage.get('component:button');

// Batch operations
const components = await storage.mget([
  'component:button',
  'component:card',
  'component:dialog'
]);

// Metadata
const metadata = await storage.getMetadata('component:button');
console.log(`Accessed ${metadata.accessCount} times`);

// Existing cache.ts still works independently
cache.set('legacy:key', 'value');
const legacyValue = cache.get('legacy:key');
```

### Implementation Approach
The memory storage provider will be implemented as an adapter around the existing `Cache` class:

1. **Phase 1**: Create adapter that delegates to existing `Cache`
   - Preserves all current functionality
   - No breaking changes to existing code
   - Adds async wrappers for interface compliance

2. **Phase 2**: Enhance with new features
   - Add metadata tracking (access counts, timestamps)
   - Implement batch operations
   - Add size limit enforcement

3. **Phase 3** (Future): Optional migration
   - Gradually move Cache class features into provider
   - Deprecate direct Cache usage in favor of storage provider

### Notes
- The existing `cache.ts` already handles TTL well, no need for external libraries
- Thread-safety not a concern in Node.js single-threaded model
- Plan for future extensibility (e.g., LRU eviction, compression)
- Consider shared cache instance vs isolated instances per provider