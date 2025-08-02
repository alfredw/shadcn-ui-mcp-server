# Task 06: Migration Utilities for Existing Cache

## Overview
Create utilities to migrate data from the existing in-memory Map-based cache to the new PGLite storage system. This ensures a smooth transition for existing users without data loss and provides rollback capabilities if needed.

## Objectives
- Detect and read existing cache formats
- Migrate data to PGLite database
- Provide rollback mechanism
- Handle version compatibility
- Create backup before migration
- Support incremental migrations

## Technical Requirements

### Migration Manager
```typescript
interface MigrationConfig {
  sourcePath?: string;          // Custom source cache location
  targetPath?: string;          // Custom target database location
  backupPath?: string;          // Backup location
  batchSize?: number;           // Items per batch (default: 100)
  preserveOriginal?: boolean;   // Keep source cache after migration
  dryRun?: boolean;            // Preview migration without changes
}

class CacheMigrationManager {
  private logger: Logger;
  private progressTracker: ProgressTracker;
  
  constructor(private config: MigrationConfig) {
    this.logger = new Logger('CacheMigration');
    this.progressTracker = new ProgressTracker();
  }
  
  async migrate(): Promise<MigrationResult> {
    // 1. Detect existing cache
    const sourceCache = await this.detectExistingCache();
    if (!sourceCache) {
      return { status: 'no_cache_found', itemsMigrated: 0 };
    }
    
    // 2. Create backup
    if (!this.config.dryRun) {
      await this.createBackup(sourceCache);
    }
    
    // 3. Initialize target database
    const targetDb = await this.initializeTargetDatabase();
    
    // 4. Perform migration
    const result = await this.performMigration(sourceCache, targetDb);
    
    // 5. Verify migration
    await this.verifyMigration(result);
    
    // 6. Cleanup if requested
    if (!this.config.preserveOriginal && result.status === 'success') {
      await this.cleanupSourceCache(sourceCache);
    }
    
    return result;
  }
  
  async rollback(): Promise<void> {
    // Restore from backup
  }
}
```

### Cache Detection Strategy
```typescript
interface CacheDetector {
  detectCacheType(path: string): Promise<CacheType>;
  readCache(type: CacheType, path: string): Promise<CacheData>;
}

enum CacheType {
  MAP_BASED = 'map-based',      // Current implementation
  JSON_FILE = 'json-file',      // Alternative format
  SQLITE = 'sqlite',            // Legacy SQLite
  UNKNOWN = 'unknown'
}

class ExistingCacheDetector implements CacheDetector {
  async detectExistingCache(): Promise<CacheLocation | null> {
    const possibleLocations = [
      // In-memory cache dump locations
      path.join(process.cwd(), '.cache', 'shadcn-mcp'),
      path.join(os.homedir(), '.cache', 'shadcn-mcp'),
      path.join(os.tmpdir(), 'shadcn-mcp-cache'),
      
      // Legacy locations
      path.join(process.cwd(), 'cache.json'),
      path.join(process.cwd(), '.shadcn-cache')
    ];
    
    for (const location of possibleLocations) {
      if (await this.isValidCache(location)) {
        const type = await this.detectCacheType(location);
        return { path: location, type };
      }
    }
    
    return null;
  }
  
  async readMapBasedCache(cachePath: string): Promise<Map<string, any>> {
    // Read serialized Map data
    const data = await fs.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(data);
    
    // Reconstruct Map with proper types
    const cache = new Map<string, any>();
    
    for (const [key, value] of Object.entries(parsed)) {
      // Parse component/block data
      if (key.startsWith('component:') || key.startsWith('block:')) {
        cache.set(key, this.parseComponentData(value));
      } else {
        cache.set(key, value);
      }
    }
    
    return cache;
  }
}
```

### Data Transformation
```typescript
class DataTransformer {
  transformForPGLite(key: string, value: any): TransformedData {
    const parsed = this.parseKey(key);
    
    switch (parsed.type) {
      case 'component':
        return this.transformComponent(parsed, value);
      
      case 'block':
        return this.transformBlock(parsed, value);
      
      case 'metadata':
        return this.transformMetadata(parsed, value);
      
      default:
        return this.transformGeneric(key, value);
    }
  }
  
  private transformComponent(parsed: ParsedKey, data: any): TransformedData {
    return {
      table: 'components',
      data: {
        framework: parsed.framework,
        name: parsed.name,
        source_code: data.sourceCode || data.source_code || data.code,
        demo_code: data.demoCode || data.demo_code,
        metadata: JSON.stringify(data.metadata || {}),
        dependencies: data.dependencies || [],
        registry_dependencies: data.registryDependencies || [],
        github_sha: data.githubSha || data.github_sha,
        file_size: data.fileSize || data.file_size || 0,
        last_modified: data.lastModified || data.last_modified,
        cached_at: data.cachedAt || new Date()
      }
    };
  }
}
```

### Batch Migration Process
```typescript
class BatchMigrator {
  async performMigration(
    source: Map<string, any>, 
    target: PGLite
  ): Promise<MigrationResult> {
    const items = Array.from(source.entries());
    const totalItems = items.length;
    const batchSize = this.config.batchSize || 100;
    
    let migrated = 0;
    let failed = 0;
    const errors: MigrationError[] = [];
    
    // Process in batches
    for (let i = 0; i < totalItems; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      try {
        await target.query('BEGIN');
        
        for (const [key, value] of batch) {
          try {
            const transformed = this.transformer.transformForPGLite(key, value);
            await this.insertData(target, transformed);
            migrated++;
          } catch (error) {
            failed++;
            errors.push({
              key,
              error: error.message,
              data: value
            });
          }
        }
        
        await target.query('COMMIT');
        
        // Update progress
        this.progressTracker.update({
          current: i + batch.length,
          total: totalItems,
          migrated,
          failed
        });
        
      } catch (error) {
        await target.query('ROLLBACK');
        throw new Error(`Batch migration failed: ${error.message}`);
      }
    }
    
    return {
      status: failed === 0 ? 'success' : 'partial',
      itemsMigrated: migrated,
      itemsFailed: failed,
      errors,
      duration: this.progressTracker.getDuration()
    };
  }
}
```

### Verification and Rollback
```typescript
class MigrationVerifier {
  async verifyMigration(result: MigrationResult): Promise<VerificationResult> {
    const checks = [
      this.verifyRecordCount(result),
      this.verifyDataIntegrity(result),
      this.verifyAccessibility(result),
      this.performSpotChecks(result)
    ];
    
    const results = await Promise.all(checks);
    
    return {
      passed: results.every(r => r.passed),
      checks: results
    };
  }
  
  async performSpotChecks(result: MigrationResult): Promise<CheckResult> {
    // Random sample verification
    const sampleSize = Math.min(10, result.itemsMigrated);
    const samples = await this.getRandomSamples(sampleSize);
    
    for (const sample of samples) {
      const original = await this.getFromSource(sample.key);
      const migrated = await this.getFromTarget(sample.key);
      
      if (!this.compareData(original, migrated)) {
        return {
          passed: false,
          message: `Data mismatch for key: ${sample.key}`
        };
      }
    }
    
    return { passed: true, message: 'Spot checks passed' };
  }
}

class MigrationRollback {
  async rollback(backupPath: string): Promise<void> {
    const spinner = ora('Rolling back migration...').start();
    
    try {
      // 1. Clear current database
      await this.clearDatabase();
      
      // 2. Restore from backup
      await this.restoreBackup(backupPath);
      
      // 3. Verify restoration
      const verified = await this.verifyRestoration();
      
      if (verified) {
        spinner.succeed('Migration rolled back successfully');
      } else {
        spinner.fail('Rollback verification failed');
      }
      
    } catch (error) {
      spinner.fail(`Rollback failed: ${error.message}`);
      throw error;
    }
  }
}
```

### CLI Integration
```typescript
// Add migration commands to CLI
program
  .command('migrate')
  .description('Migrate existing cache to PGLite')
  .option('--dry-run', 'preview migration without changes')
  .option('--backup-path <path>', 'custom backup location')
  .option('--preserve-original', 'keep source cache after migration')
  .option('--batch-size <size>', 'items per batch', parseInt)
  .action(async (options) => {
    const migrator = new CacheMigrationManager(options);
    
    try {
      console.log('🔄 Starting cache migration...');
      
      const result = await migrator.migrate();
      
      if (result.status === 'success') {
        console.log(`✅ Migration completed successfully`);
        console.log(`   Migrated: ${result.itemsMigrated} items`);
        console.log(`   Duration: ${result.duration}ms`);
      } else if (result.status === 'partial') {
        console.log(`⚠️  Migration partially completed`);
        console.log(`   Migrated: ${result.itemsMigrated} items`);
        console.log(`   Failed: ${result.itemsFailed} items`);
      }
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }
  });
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/migration/
   ├── manager.ts
   ├── detector.ts
   ├── transformer.ts
   ├── migrator.ts
   ├── verifier.ts
   └── rollback.ts
   ```

2. **Progress Tracking**:
   - Real-time progress updates
   - ETA calculation
   - Failed item logging
   - Memory usage monitoring

3. **Error Recovery**:
   - Partial migration support
   - Failed item retry
   - Detailed error logs

### Acceptance Criteria
- [ ] Detects existing cache in multiple locations
- [ ] Transforms data correctly for all types
- [ ] Batch processing works efficiently
- [ ] Progress tracking provides accurate updates
- [ ] Verification catches data integrity issues
- [ ] Rollback restores original state
- [ ] Dry run mode shows accurate preview

### Testing Requirements
- Unit tests for each transformer
- Integration tests with sample caches
- Large dataset migration tests
- Corruption handling tests
- Rollback scenario tests
- Progress tracking tests

### Dependencies
- Task 02: PGLite Database Initialization
- Task 03: PGLite Storage Provider
- npm packages: ora, fs-extra

### Estimated Effort
- 3-4 days

### Example Usage
```bash
# Detect and preview migration
npx @jpisnice/shadcn-ui-mcp-server migrate --dry-run

# Perform migration with custom backup
npx @jpisnice/shadcn-ui-mcp-server migrate --backup-path ./backups/

# Migrate and preserve original
npx @jpisnice/shadcn-ui-mcp-server migrate --preserve-original

# Rollback if needed
npx @jpisnice/shadcn-ui-mcp-server migrate rollback --backup ./backups/cache-backup-2024-01-15.db

# Migration output
🔄 Starting cache migration...
📦 Found existing cache at ~/.cache/shadcn-mcp (150 items, 45.2 MB)
💾 Creating backup at ~/.shadcn-mcp/backups/cache-backup-2024-01-15.db
📊 Migrating data in batches of 100...
   [████████████████████████] 100% | 150/150 items | ETA: 0s
✅ Migration completed successfully
   Migrated: 150 items
   Duration: 2341ms
   
✨ Your cache has been upgraded to PGLite!
```

### Notes
- Consider adding cache format version detection
- Support for custom transformation rules
- Add migration history tracking
- Document manual migration procedures