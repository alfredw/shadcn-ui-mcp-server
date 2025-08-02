# PGLite Persistent Storage Implementation

## Overview

This document outlines the implementation plan for integrating PGLite as a persistent storage solution for the shadcn-ui-mcp-server, replacing the current in-memory cache with a lightweight embedded PostgreSQL database.

## Motivation

### Current Limitations
1. **Volatile Storage**: In-memory Map cache is lost on every server restart
2. **GitHub API Dependency**: Requires API token for reasonable performance (60 vs 5000 requests/hour)
3. **Network Overhead**: Every component fetch requires a network request
4. **No Offline Support**: Complete dependency on GitHub availability

### PGLite Solution Benefits
1. **Persistent Storage**: Data survives across npx runs
2. **Reduced API Calls**: Local database queries instead of network requests
3. **Better Performance**: Sub-millisecond local queries vs network latency
4. **Offline Capability**: Works without internet after initial cache
5. **Structured Data**: SQL queries for advanced filtering and searching
6. **Small Footprint**: ~3MB for PGLite vs 100MB+ for full repository clones

## Architecture Design

### Storage Location Strategy

```typescript
// Determine storage location based on execution context
function getStoragePath(): string {
  const isNpx = process.argv[1].includes('_npx');
  
  if (isNpx || !process.env.SHADCN_MCP_LOCAL_PATH) {
    // Default: User's home directory
    return path.join(os.homedir(), '.shadcn-mcp', 'cache.db');
  }
  
  // Custom path for local installations
  return process.env.SHADCN_MCP_LOCAL_PATH;
}
```

### Hybrid Storage Strategy

The implementation will support multiple storage backends:

```typescript
interface StorageProvider {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

class HybridStorage {
  private providers: {
    memory: MemoryStorage;    // Fast L1 cache
    pglite: PGLiteStorage;    // Persistent L2 cache
    github: GitHubStorage;    // Fallback source
  }
  
  async get(key: string): Promise<any> {
    // Try memory first (fastest)
    if (await this.providers.memory.has(key)) {
      return this.providers.memory.get(key);
    }
    
    // Try PGLite (persistent)
    if (await this.providers.pglite.has(key)) {
      const value = await this.providers.pglite.get(key);
      await this.providers.memory.set(key, value); // Promote to L1
      return value;
    }
    
    // Fallback to GitHub (source of truth)
    const value = await this.providers.github.get(key);
    await this.providers.pglite.set(key, value);   // Cache in L2
    await this.providers.memory.set(key, value);   // Cache in L1
    return value;
  }
}
```

## Database Schema

### Components Table
```sql
CREATE TABLE components (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  source_code TEXT NOT NULL,
  demo_code TEXT,
  metadata JSONB,
  dependencies TEXT[],
  registry_dependencies TEXT[],
  github_sha VARCHAR(40),
  file_size INTEGER,
  last_modified TIMESTAMP,
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  UNIQUE(framework, name)
);

CREATE INDEX idx_components_framework_name ON components(framework, name);
CREATE INDEX idx_components_cached_at ON components(cached_at);
CREATE INDEX idx_components_accessed_at ON components(accessed_at);
```

### Blocks Table
```sql
CREATE TABLE blocks (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  type VARCHAR(20) CHECK (type IN ('simple', 'complex')),
  description TEXT,
  files JSONB NOT NULL, -- Stores all file contents
  structure JSONB,      -- Directory structure metadata
  dependencies TEXT[],
  components_used TEXT[],
  total_size INTEGER,
  github_sha VARCHAR(40),
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  UNIQUE(framework, name)
);

CREATE INDEX idx_blocks_framework_name ON blocks(framework, name);
CREATE INDEX idx_blocks_category ON blocks(category);
CREATE INDEX idx_blocks_cached_at ON blocks(cached_at);
```

### Metadata Table
```sql
CREATE TABLE cache_metadata (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store rate limit info, last sync times, etc.
INSERT INTO cache_metadata (key, value) VALUES 
  ('github_rate_limit', '{"limit": 5000, "remaining": 4999, "reset": 1234567890}'),
  ('last_full_sync', '{"timestamp": "2024-01-01T00:00:00Z", "components": 150, "blocks": 50}'),
  ('cache_version', '{"version": "1.0.0", "schema_version": 1}');
```

### Cache Statistics Table
```sql
CREATE TABLE cache_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  framework VARCHAR(50) NOT NULL,
  resource_type VARCHAR(20) NOT NULL,
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  github_fetches INTEGER DEFAULT 0,
  avg_response_time_ms FLOAT,
  UNIQUE(date, framework, resource_type)
);
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
1. Add PGLite dependency
2. Create database interface abstraction
3. Implement schema initialization
4. Create migration utilities

### Phase 2: Core Implementation (Week 2)
1. Implement PGLiteStorage provider
2. Update axios implementations to use hybrid storage
3. Add cache management commands
4. Implement background sync

### Phase 3: Migration & Testing (Week 3)
1. Create migration path from existing cache
2. Add comprehensive tests
3. Performance benchmarking
4. Documentation updates

### Phase 4: Advanced Features (Week 4)
1. Implement cache analytics
2. Add component search functionality
3. Version tracking
4. Offline mode improvements

## Performance Considerations

### Query Optimization
```sql
-- Frequently accessed components
CREATE MATERIALIZED VIEW popular_components AS
SELECT framework, name, source_code, demo_code
FROM components
WHERE access_count > 10
ORDER BY access_count DESC;

-- Refresh periodically
REFRESH MATERIALIZED VIEW popular_components;
```

### Cache Strategies
1. **TTL-based Expiration**: Components older than 7 days are refreshed
2. **Access-based Retention**: Frequently accessed items have extended TTL
3. **Size-based Eviction**: Limit total cache size to 100MB
4. **Smart Prefetching**: Preload related components

### Benchmarks (Expected)
```
Operation           | Current (GitHub) | With PGLite
--------------------|------------------|-------------
First component     | 200-500ms        | 200-500ms
Cached component    | 200-500ms        | <5ms
Bulk list           | 500-1000ms       | <10ms
Offline access      | ❌ Error         | ✅ <5ms
```

## Migration Strategy

### Automatic Migration
```typescript
class CacheMigration {
  async migrate() {
    // Check if old cache exists
    const oldCache = this.detectOldCache();
    if (!oldCache) return;
    
    // Migrate data
    for (const [key, value] of oldCache.entries()) {
      await this.pglite.query(`
        INSERT INTO components (framework, name, source_code, cached_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (framework, name) DO NOTHING
      `, [framework, name, sourceCode, cachedAt]);
    }
    
    // Clean up old cache
    await this.cleanupOldCache();
  }
}
```

### Backwards Compatibility
- Environment variable to force GitHub-only mode
- Graceful fallback if PGLite initialization fails
- Option to disable persistent cache

## User Experience Improvements

### CLI Enhancements
```bash
# Cache management commands
npx @jpisnice/shadcn-ui-mcp-server --cache-stats
npx @jpisnice/shadcn-ui-mcp-server --clear-cache
npx @jpisnice/shadcn-ui-mcp-server --refresh-cache
npx @jpisnice/shadcn-ui-mcp-server --cache-size

# Force modes
npx @jpisnice/shadcn-ui-mcp-server --offline-only
npx @jpisnice/shadcn-ui-mcp-server --github-only
```

### First Run Experience
```
$ npx @jpisnice/shadcn-ui-mcp-server
🚀 Initializing shadcn-ui MCP server...
📦 Creating local cache at ~/.shadcn-mcp/cache.db
✅ Cache initialized successfully
🔄 Syncing component metadata... (this may take a moment)
✨ Ready! Components will be cached for faster access
```

### Performance Feedback
```
$ npx @jpisnice/shadcn-ui-mcp-server --cache-stats
📊 Cache Statistics:
  Total components: 150 (45.2 MB)
  Total blocks: 50 (12.8 MB)
  Cache hit rate: 92.3%
  Average response time: 4.2ms
  Last sync: 2 hours ago
```

## Security Considerations

1. **SQL Injection**: Use parameterized queries exclusively
2. **Path Traversal**: Validate all file paths
3. **Cache Poisoning**: Verify GitHub SHA on updates
4. **Disk Usage**: Implement size limits and cleanup

## Configuration Options

```typescript
interface PGLiteConfig {
  // Storage location
  path?: string;                    // Default: ~/.shadcn-mcp/cache.db
  
  // Cache behavior
  maxSizeBytes?: number;            // Default: 100MB
  ttlSeconds?: number;              // Default: 7 days
  offlineMode?: boolean;            // Default: false
  
  // Performance
  enableMaterializedViews?: boolean; // Default: true
  backgroundSync?: boolean;          // Default: true
  syncIntervalMinutes?: number;      // Default: 60
  
  // Debugging
  logQueries?: boolean;              // Default: false
  collectStats?: boolean;            // Default: true
}
```

## Testing Strategy

### Unit Tests
- Storage provider interface compliance
- Schema migrations
- Cache eviction policies
- Query performance

### Integration Tests
- GitHub API fallback
- Offline functionality
- Cache consistency
- Migration scenarios

### Performance Tests
- Response time benchmarks
- Memory usage profiling
- Concurrent access handling
- Large dataset performance

## Rollout Plan

1. **Beta Release**: Optional flag `--enable-pglite`
2. **Gradual Rollout**: Enable by default with fallback
3. **Full Migration**: Remove in-memory only option
4. **Deprecation**: Remove old cache system

## Future Enhancements

1. **Component Search**: Full-text search across components
2. **Dependency Graph**: Track component relationships
3. **Version History**: Store multiple versions of components
4. **Sync Optimization**: Delta updates instead of full refresh
5. **Multi-User Cache**: Shared cache for teams
6. **Cache Sharing**: Export/import cache bundles

## Conclusion

PGLite integration will transform the shadcn-ui-mcp-server from a stateless API proxy into an intelligent caching layer that provides superior performance, offline capabilities, and a better developer experience while maintaining the simplicity of the npx workflow.