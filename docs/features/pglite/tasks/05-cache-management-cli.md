# Task 05: Cache Management CLI Commands

## Overview
Add command-line interface commands for managing the PGLite cache, including viewing statistics, clearing cache, refreshing data, and performing maintenance operations. These commands enhance the user experience and provide visibility into cache operations.

## Objectives
- Parse and handle cache-specific CLI arguments
- Implement cache statistics display
- Add cache clearing functionality
- Create cache refresh/sync commands
- Provide cache inspection tools
- Add offline mode toggle

## Technical Requirements

### CLI Command Structure
```typescript
interface CacheCommand {
  name: string;
  aliases?: string[];
  description: string;
  options?: CommandOption[];
  action: (options: any) => Promise<void>;
}

interface CommandOption {
  flag: string;
  description: string;
  defaultValue?: any;
  type?: 'boolean' | 'string' | 'number';
}

const cacheCommands: CacheCommand[] = [
  {
    name: 'cache-stats',
    aliases: ['stats'],
    description: 'Display cache statistics and metrics',
    options: [
      { flag: '--format <format>', description: 'Output format (json|table)', defaultValue: 'table' },
      { flag: '--detailed', description: 'Show detailed statistics', type: 'boolean' }
    ],
    action: handleCacheStats
  },
  {
    name: 'clear-cache',
    aliases: ['clear'],
    description: 'Clear cache data',
    options: [
      { flag: '--framework <name>', description: 'Clear specific framework cache' },
      { flag: '--type <type>', description: 'Clear specific type (components|blocks|all)' },
      { flag: '--older-than <days>', description: 'Clear items older than N days', type: 'number' },
      { flag: '--force', description: 'Skip confirmation prompt', type: 'boolean' }
    ],
    action: handleClearCache
  },
  // ... more commands
];
```

### CLI Parser Enhancement
```typescript
// Update src/index.ts to handle cache commands
import { program } from 'commander';
import { CacheManager } from './cache/manager';

function setupCacheCommands(program: Command) {
  const cache = program
    .command('cache')
    .description('Cache management commands');
  
  // Stats command
  cache
    .command('stats')
    .description('Display cache statistics')
    .option('-f, --format <format>', 'output format', 'table')
    .option('-d, --detailed', 'show detailed statistics')
    .action(async (options) => {
      const manager = new CacheManager();
      await manager.displayStats(options);
    });
  
  // Clear command
  cache
    .command('clear')
    .description('Clear cache data')
    .option('--framework <name>', 'clear specific framework')
    .option('--type <type>', 'clear specific type')
    .option('--older-than <days>', 'clear old items', parseInt)
    .option('-f, --force', 'skip confirmation')
    .action(async (options) => {
      const manager = new CacheManager();
      await manager.clearCache(options);
    });
  
  // More commands...
}

// Alternative: Direct flags on main command
program
  .option('--cache-stats', 'display cache statistics')
  .option('--clear-cache', 'clear all cache data')
  .option('--refresh-cache', 'refresh cache from GitHub')
  .option('--cache-size', 'show cache disk usage')
  .option('--offline-only', 'use only cached data')
  .option('--github-only', 'bypass cache, use GitHub directly');
```

### Cache Statistics Implementation
```typescript
class CacheStatsCollector {
  async collectStats(): Promise<CacheStats> {
    const db = await this.getDatabase();
    
    const stats = {
      components: {
        total: await this.countComponents(db),
        byFramework: await this.countByFramework(db, 'components'),
        totalSize: await this.calculateSize(db, 'components'),
        avgAccessCount: await this.avgAccessCount(db, 'components'),
        lastUpdated: await this.lastUpdated(db, 'components')
      },
      blocks: {
        total: await this.countBlocks(db),
        byFramework: await this.countByFramework(db, 'blocks'),
        byCategory: await this.countByCategory(db),
        totalSize: await this.calculateSize(db, 'blocks')
      },
      cache: {
        hitRate: await this.calculateHitRate(db),
        avgResponseTime: await this.avgResponseTime(db),
        githubApiCalls: await this.countGitHubCalls(db),
        diskUsage: await this.getDiskUsage(),
        oldestEntry: await this.getOldestEntry(db),
        newestEntry: await this.getNewestEntry(db)
      }
    };
    
    return stats;
  }
  
  formatStats(stats: CacheStats, format: 'table' | 'json'): string {
    if (format === 'json') {
      return JSON.stringify(stats, null, 2);
    }
    
    // Table format
    return `
📊 Cache Statistics
════════════════════════════════════════════

Components:
  Total: ${stats.components.total} (${formatBytes(stats.components.totalSize)})
  React: ${stats.components.byFramework.react || 0}
  Svelte: ${stats.components.byFramework.svelte || 0}
  Average Access Count: ${stats.components.avgAccessCount}
  Last Updated: ${formatDate(stats.components.lastUpdated)}

Blocks:
  Total: ${stats.blocks.total} (${formatBytes(stats.blocks.totalSize)})
  By Category:
    ${Object.entries(stats.blocks.byCategory)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join('\n    ')}

Performance:
  Cache Hit Rate: ${stats.cache.hitRate.toFixed(1)}%
  Avg Response Time: ${stats.cache.avgResponseTime}ms
  GitHub API Calls: ${stats.cache.githubApiCalls}
  
Storage:
  Disk Usage: ${formatBytes(stats.cache.diskUsage)}
  Oldest Entry: ${formatDate(stats.cache.oldestEntry)}
  Newest Entry: ${formatDate(stats.cache.newestEntry)}
`;
  }
}
```

### Cache Clear Implementation
```typescript
class CacheCleaner {
  async clearCache(options: ClearOptions): Promise<void> {
    // Confirm with user unless --force
    if (!options.force) {
      const confirmed = await this.confirmClear(options);
      if (!confirmed) return;
    }
    
    const db = await this.getDatabase();
    
    try {
      await db.query('BEGIN');
      
      if (options.olderThan) {
        // Clear old entries
        const date = new Date();
        date.setDate(date.getDate() - options.olderThan);
        
        await db.query(`
          DELETE FROM components 
          WHERE cached_at < $1
          ${options.framework ? 'AND framework = $2' : ''}
        `, options.framework ? [date, options.framework] : [date]);
        
      } else if (options.type === 'components' || options.type === 'all') {
        // Clear components
        await db.query(
          options.framework 
            ? 'DELETE FROM components WHERE framework = $1'
            : 'DELETE FROM components',
          options.framework ? [options.framework] : []
        );
      }
      
      // Similar for blocks...
      
      await db.query('COMMIT');
      
      console.log('✅ Cache cleared successfully');
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}
```

### Cache Refresh Implementation
```typescript
class CacheRefresher {
  async refreshCache(options: RefreshOptions): Promise<void> {
    const spinner = ora('Refreshing cache from GitHub...').start();
    
    try {
      const github = new GitHubStorageProvider(this.config);
      const pglite = new PGLiteStorageProvider(this.dbManager);
      
      // Get list of components/blocks to refresh
      const items = await this.getItemsToRefresh(options);
      
      let refreshed = 0;
      let failed = 0;
      
      for (const item of items) {
        try {
          // Fetch from GitHub
          const fresh = await github.get(item.key);
          
          // Update in PGLite
          await pglite.set(item.key, fresh);
          
          refreshed++;
          spinner.text = `Refreshing cache... (${refreshed}/${items.length})`;
          
        } catch (error) {
          failed++;
          this.logger.error(`Failed to refresh ${item.key}:`, error);
        }
      }
      
      spinner.succeed(`Cache refreshed: ${refreshed} items updated, ${failed} failed`);
      
    } catch (error) {
      spinner.fail('Cache refresh failed');
      throw error;
    }
  }
}
```

### Offline Mode Toggle
```typescript
class OfflineModeManager {
  async setOfflineMode(enabled: boolean): Promise<void> {
    // Update configuration
    await this.config.set('offlineMode', enabled);
    
    if (enabled) {
      console.log('🔌 Offline mode enabled - using cached data only');
      
      // Check cache health
      const stats = await this.cacheStats.collectStats();
      if (stats.components.total === 0) {
        console.warn('⚠️  Warning: Cache is empty. Run --refresh-cache first.');
      }
    } else {
      console.log('🌐 Online mode enabled - cache with GitHub fallback');
    }
  }
}
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/cli/
   ├── commands/
   │   ├── cache-stats.ts
   │   ├── clear-cache.ts
   │   ├── refresh-cache.ts
   │   └── inspect-cache.ts
   ├── formatters/
   │   ├── table.ts
   │   └── json.ts
   └── utils/
       ├── confirmation.ts
       └── progress.ts
   ```

2. **User Experience**:
   - Interactive confirmations
   - Progress indicators
   - Colored output
   - Clear success/error messages

3. **Error Handling**:
   - Graceful failures
   - Helpful error messages
   - Rollback on errors

### Acceptance Criteria
- [ ] All cache commands parse correctly
- [ ] Stats command shows accurate metrics
- [ ] Clear command works with all filter options
- [ ] Refresh command updates stale data
- [ ] Offline mode toggle works correctly
- [ ] Progress indicators show during long operations
- [ ] Help text is clear and comprehensive

### Testing Requirements
- Unit tests for command parsing
- Integration tests for each command
- Tests for confirmation prompts
- Progress indicator tests
- Error scenario tests
- Mock GitHub API for refresh tests

### Dependencies
- Task 03: PGLite Storage Provider
- Task 04: Hybrid Storage Orchestrator
- npm packages: commander, ora, chalk, cli-table3

### Estimated Effort
- 2-3 days

### Example Usage
```bash
# View cache statistics
npx @jpisnice/shadcn-ui-mcp-server cache stats
npx @jpisnice/shadcn-ui-mcp-server --cache-stats --format json

# Clear cache
npx @jpisnice/shadcn-ui-mcp-server cache clear --framework react
npx @jpisnice/shadcn-ui-mcp-server --clear-cache --older-than 30

# Refresh cache
npx @jpisnice/shadcn-ui-mcp-server cache refresh
npx @jpisnice/shadcn-ui-mcp-server --refresh-cache --framework svelte

# Inspect specific items
npx @jpisnice/shadcn-ui-mcp-server cache inspect component:react:button

# Offline mode
npx @jpisnice/shadcn-ui-mcp-server --offline-only
npx @jpisnice/shadcn-ui-mcp-server cache offline --enable
```

### Notes
- Consider adding cache export/import commands
- Add support for cache integrity checks
- Implement cache optimization command
- Document recommended maintenance schedules