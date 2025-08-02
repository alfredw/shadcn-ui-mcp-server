# Task 02: PGLite Database Initialization and Schema Setup

## Overview
Implement the PGLite database initialization system including schema creation, migrations, and connection management. This task establishes the persistent storage foundation.

## Objectives
- Add PGLite dependency and TypeScript types
- Create database initialization module
- Implement schema creation scripts
- Build migration system for future updates
- Handle database location strategy

## Technical Requirements

### Database Manager Module
```typescript
interface DatabaseConfig {
  path?: string;                    // Custom path or auto-detect
  maxSizeBytes?: number;           // Default: 100MB
  enableWAL?: boolean;             // Write-Ahead Logging
  busyTimeout?: number;            // Default: 5000ms
}

class PGLiteManager {
  private db: PGLite | null = null;
  private config: DatabaseConfig;
  private schemaVersion: number = 1;
  
  constructor(config: DatabaseConfig) {
    this.config = {
      maxSizeBytes: 100 * 1024 * 1024,
      enableWAL: true,
      busyTimeout: 5000,
      ...config
    };
  }
  
  async initialize(): Promise<void>;
  async close(): Promise<void>;
  async getConnection(): Promise<PGLite>;
  async runMigrations(): Promise<void>;
  async checkHealth(): Promise<boolean>;
}
```

### Database Location Strategy
```typescript
function getStoragePath(): string {
  const isNpx = process.argv[1].includes('_npx');
  
  if (process.env.SHADCN_MCP_DB_PATH) {
    // User-specified path
    return process.env.SHADCN_MCP_DB_PATH;
  }
  
  if (isNpx || !process.env.SHADCN_MCP_LOCAL_PATH) {
    // Default: User's home directory
    return path.join(os.homedir(), '.shadcn-mcp', 'cache.db');
  }
  
  // Local installation path
  return path.join(process.env.SHADCN_MCP_LOCAL_PATH, 'cache.db');
}
```

### Schema Definition
Create SQL files in `src/storage/schemas/`:

**001_initial_schema.sql**:
```sql
-- Components table
CREATE TABLE IF NOT EXISTS components (
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

-- Indexes
CREATE INDEX idx_components_framework_name ON components(framework, name);
CREATE INDEX idx_components_cached_at ON components(cached_at);
CREATE INDEX idx_components_accessed_at ON components(accessed_at);

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  type VARCHAR(20) CHECK (type IN ('simple', 'complex')),
  description TEXT,
  files JSONB NOT NULL,
  structure JSONB,
  dependencies TEXT[],
  components_used TEXT[],
  total_size INTEGER,
  github_sha VARCHAR(40),
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  UNIQUE(framework, name)
);

-- Indexes
CREATE INDEX idx_blocks_framework_name ON blocks(framework, name);
CREATE INDEX idx_blocks_category ON blocks(category);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Migration System
```typescript
interface Migration {
  version: number;
  name: string;
  up: string;   // SQL to apply
  down: string; // SQL to rollback
}

class MigrationRunner {
  async getCurrentVersion(): Promise<number>;
  async applyMigration(migration: Migration): Promise<void>;
  async rollbackMigration(migration: Migration): Promise<void>;
  async runPendingMigrations(): Promise<void>;
}
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/storage/
   ├── database/
   │   ├── manager.ts
   │   ├── migrations.ts
   │   └── connection.ts
   ├── schemas/
   │   ├── 001_initial_schema.sql
   │   └── migrations/
   └── utils/
       └── paths.ts
   ```

2. **Error Handling**:
   - Database file creation failures
   - Permission issues
   - Disk space limitations
   - Corrupted database recovery

3. **Connection Pooling**:
   - Single connection for embedded database
   - Connection lifecycle management
   - Automatic reconnection logic

### Acceptance Criteria
- [ ] PGLite dependency added to package.json
- [ ] Database initializes at correct location based on context
- [ ] Schema creates successfully on first run
- [ ] Migration system tracks and applies changes
- [ ] Graceful handling of initialization failures
- [ ] Database health check endpoint
- [ ] Proper cleanup on shutdown

### Testing Requirements
- Test database initialization in different environments
- Test migration application and rollback
- Test corruption recovery
- Test disk space handling
- Test concurrent initialization attempts

### Dependencies
- Task 01: Storage Provider Interface (for error types)
- npm packages: @electric-sql/pglite

### Estimated Effort
- 3-4 days

### Example Usage
```typescript
import { PGLiteManager } from './storage/database/manager';

const dbManager = new PGLiteManager({
  path: getStoragePath(),
  maxSizeBytes: 100 * 1024 * 1024
});

try {
  await dbManager.initialize();
  console.log('Database initialized successfully');
  
  const db = await dbManager.getConnection();
  const result = await db.query('SELECT COUNT(*) FROM components');
  console.log(`Components in cache: ${result.rows[0].count}`);
} catch (error) {
  console.error('Database initialization failed:', error);
  // Fallback to in-memory storage
}
```

### Notes
- Consider using `fs.ensureDir` to create parent directories
- Add database file size monitoring
- Plan for future sharding if needed
- Document backup/restore procedures