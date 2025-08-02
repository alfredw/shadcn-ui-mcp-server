# Task 03: PGLite Storage Provider Implementation

## Overview
Implement the PGLite storage provider that conforms to the StorageProvider interface. This provider will handle persistent storage of components and blocks in the PGLite database.

## Objectives
- Create PGLite storage provider class
- Implement all StorageProvider interface methods
- Add component and block-specific storage logic
- Handle serialization/deserialization of complex data
- Implement efficient querying and indexing

## Technical Requirements

### PGLite Storage Provider
```typescript
class PGLiteStorageProvider extends BaseStorageProvider {
  private dbManager: PGLiteManager;
  private db: PGLite | null = null;
  
  constructor(dbManager: PGLiteManager, config?: StorageConfig) {
    super(config);
    this.dbManager = dbManager;
  }
  
  async initialize(): Promise<void> {
    this.db = await this.dbManager.getConnection();
  }
  
  // Core implementations
  async get(key: string): Promise<any>;
  async set(key: string, value: any, ttl?: number): Promise<void>;
  async has(key: string): Promise<boolean>;
  async delete(key: string): Promise<boolean>;
  
  // Component-specific methods
  async getComponent(framework: string, name: string): Promise<Component>;
  async setComponent(component: Component): Promise<void>;
  async listComponents(framework: string): Promise<ComponentMetadata[]>;
  
  // Block-specific methods
  async getBlock(framework: string, name: string): Promise<Block>;
  async setBlock(block: Block): Promise<void>;
  async listBlocks(framework: string, category?: string): Promise<BlockMetadata[]>;
}
```

### Key Parsing Strategy
```typescript
interface KeyParser {
  parseKey(key: string): ParsedKey;
  buildKey(type: string, framework: string, name: string): string;
}

interface ParsedKey {
  type: 'component' | 'block' | 'metadata' | 'other';
  framework?: string;
  name?: string;
  subkey?: string;
}

// Example keys:
// "component:react:button"
// "block:react:dashboard-01"
// "metadata:github_rate_limit"
```

### SQL Query Implementations

**Get Component**:
```sql
UPDATE components 
SET accessed_at = CURRENT_TIMESTAMP, 
    access_count = access_count + 1
WHERE framework = $1 AND name = $2
RETURNING *;
```

**Set Component with TTL**:
```sql
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
  access_count = components.access_count + 1;
```

**Batch Operations**:
```typescript
async mget(keys: string[]): Promise<Map<string, any>> {
  const parsedKeys = keys.map(k => this.parseKey(k));
  const componentKeys = parsedKeys.filter(k => k.type === 'component');
  const blockKeys = parsedKeys.filter(k => k.type === 'block');
  
  const results = new Map<string, any>();
  
  // Batch fetch components
  if (componentKeys.length > 0) {
    const components = await this.batchFetchComponents(componentKeys);
    components.forEach((comp, key) => results.set(key, comp));
  }
  
  // Batch fetch blocks
  if (blockKeys.length > 0) {
    const blocks = await this.batchFetchBlocks(blockKeys);
    blocks.forEach((block, key) => results.set(key, block));
  }
  
  return results;
}
```

### Cache Eviction Strategy
```typescript
class CacheEvictionPolicy {
  async enforceLimit(db: PGLite, maxSizeBytes: number): Promise<void> {
    // Check current size
    const currentSize = await this.calculateCacheSize(db);
    
    if (currentSize > maxSizeBytes) {
      // Evict least recently accessed items
      await db.query(`
        DELETE FROM components 
        WHERE id IN (
          SELECT id FROM components 
          ORDER BY accessed_at ASC 
          LIMIT (
            SELECT COUNT(*) FROM components 
            WHERE file_size < $1
          )
        )
      `, [bytesToEvict]);
    }
  }
}
```

### Implementation Details

1. **Transaction Management**:
   - Use transactions for multi-step operations
   - Implement retry logic for deadlocks
   - Ensure ACID compliance

2. **Data Serialization**:
   - JSON serialization for metadata
   - Array handling for dependencies
   - JSONB for complex structures

3. **Performance Optimizations**:
   - Prepared statements for frequent queries
   - Connection pooling (single connection)
   - Query result caching

### Acceptance Criteria
- [ ] All StorageProvider interface methods implemented
- [ ] Component storage/retrieval works correctly
- [ ] Block storage/retrieval works correctly
- [ ] TTL expiration handled properly
- [ ] Batch operations are efficient
- [ ] Cache size limits enforced
- [ ] Concurrent access handled safely

### Testing Requirements
- Unit tests for all public methods
- Integration tests with real PGLite database
- Performance tests for large datasets
- Concurrent operation tests
- TTL expiration tests
- Cache eviction tests

### Dependencies
- Task 01: Storage Provider Interface
- Task 02: PGLite Database Initialization

### Estimated Effort
- 4-5 days

### Example Usage
```typescript
const dbManager = new PGLiteManager(config);
await dbManager.initialize();

const storage = new PGLiteStorageProvider(dbManager);
await storage.initialize();

// Store a component
await storage.set('component:react:button', {
  framework: 'react',
  name: 'button',
  sourceCode: '...',
  demoCode: '...',
  metadata: { /* ... */ }
}, 7 * 24 * 60 * 60); // 7 days TTL

// Get a component
const button = await storage.get('component:react:button');

// List all React components
const components = await storage.listComponents('react');

// Batch operations
const keys = [
  'component:react:button',
  'component:react:card',
  'block:react:dashboard-01'
];
const items = await storage.mget(keys);
```

### Notes
- Consider implementing query caching for frequently accessed items
- Add metrics collection for cache hit/miss rates
- Plan for future full-text search capabilities
- Document index optimization strategies