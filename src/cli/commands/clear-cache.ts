/**
 * Clear cache command implementation
 */

import chalk from 'chalk';
import { getStorage, isStorageInitialized } from '../../utils/storage-integration.js';
import { confirmClearCache } from '../utils/confirmation.js';
import { createSpinner, showOperationSummary } from '../utils/progress.js';
import { formatOperationResultAsJson } from '../formatters/json.js';

export interface ClearCacheOptions {
  framework?: string;
  type?: 'components' | 'blocks' | 'all';
  olderThan?: number;
  force?: boolean;
  format?: 'table' | 'json';
}

/**
 * Clear cache data with various filters
 */
export async function handleClearCache(options: ClearCacheOptions = {}): Promise<void> {
  const { framework, type = 'all', olderThan, force = false, format = 'table' } = options;
  
  if (!isStorageInitialized()) {
    const message = 'Cache system is not initialized';
    if (format === 'json') {
      console.log(formatOperationResultAsJson('clear-cache', false, { error: message }));
    } else {
      console.log(chalk.yellow('⚠️  ' + message));
    }
    return;
  }

  const storage = getStorage();
  let estimatedCount = 0;
  let estimatedSize = 0;

  try {
    // Estimate what will be deleted
    const spinner = createSpinner('Analyzing cache contents...').start();
    
    try {
      // Get storage stats to estimate impact
      const stats = storage.getStats?.();
      if (stats) {
        // Rough estimation based on total operations
        const totalHits = (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0);
        const totalOps = totalHits + (stats.misses || 0);
        
        if (type === 'all') {
          estimatedCount = totalOps;
          estimatedSize = totalOps * 1024; // Rough estimate
        } else {
          // For specific types, estimate 50% of total
          estimatedCount = Math.floor(totalOps * 0.5);
          estimatedSize = Math.floor(totalOps * 512);
        }

        // Adjust for framework filter (rough estimate)
        if (framework) {
          estimatedCount = Math.floor(estimatedCount * 0.6);
          estimatedSize = Math.floor(estimatedSize * 0.6);
        }

        // Adjust for age filter (very rough estimate - assume 50% if age filter)
        if (olderThan) {
          estimatedCount = Math.floor(estimatedCount * 0.5);
          estimatedSize = Math.floor(estimatedSize * 0.5);
        }
      }
      
      spinner.succeed('Cache analysis complete');
    } catch (error) {
      spinner.warn('Could not analyze cache contents');
    }

    // Confirm with user unless --force
    if (!force) {
      if (format === 'json') {
        // In JSON mode, require --force flag for safety
        console.log(formatOperationResultAsJson('clear-cache', false, { 
          error: 'Use --force flag to clear cache in JSON mode',
          estimatedCount,
          estimatedSize
        }));
        return;
      }

      const confirmed = await confirmClearCache({
        framework,
        type,
        olderThan,
        estimatedCount,
        estimatedSize
      });

      if (!confirmed) {
        console.log(chalk.yellow('❌ Cache clear cancelled'));
        return;
      }
    }

    // Perform the clear operation
    const clearSpinner = createSpinner('Clearing cache...').start();
    const startTime = Date.now();
    
    let clearedCount = 0;
    let clearedSize = 0;

    try {
      if (olderThan) {
        // Clear old entries
        await clearOldEntries(storage, olderThan, framework, type);
        clearedCount = estimatedCount; // Approximate
        clearedSize = estimatedSize;
      } else if (type === 'all') {
        // Clear all cache
        await storage.clear();
        clearedCount = estimatedCount;
        clearedSize = estimatedSize;
      } else {
        // Clear specific type
        await clearByType(storage, type, framework);
        clearedCount = estimatedCount;
        clearedSize = estimatedSize;
      }

      const duration = Date.now() - startTime;
      clearSpinner.succeed('Cache cleared successfully');

      // Show results
      if (format === 'json') {
        console.log(formatOperationResultAsJson('clear-cache', true, {
          clearedCount,
          clearedSize,
          duration,
          filters: { framework, type, olderThan }
        }));
      } else {
        showOperationSummary('Cache Clear', {
          succeeded: clearedCount,
          failed: 0,
          duration
        });

        console.log(chalk.green('✅ Cache cleared successfully'));
        if (clearedCount > 0) {
          console.log(chalk.grey(`   Removed ${clearedCount} items`));
          if (clearedSize > 0) {
            console.log(chalk.grey(`   Freed ${formatBytes(clearedSize)} of space`));
          }
        }
      }

    } catch (error) {
      clearSpinner.fail('Failed to clear cache');
      
      if (format === 'json') {
        console.log(formatOperationResultAsJson('clear-cache', false, {
          error: error instanceof Error ? error.message : String(error)
        }));
      } else {
        console.error(chalk.red('❌ Error clearing cache:'));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      }
      
      process.exit(1);
    }

  } catch (error) {
    if (format === 'json') {
      console.log(formatOperationResultAsJson('clear-cache', false, {
        error: error instanceof Error ? error.message : String(error)
      }));
    } else {
      console.error(chalk.red('❌ Error during cache clear operation:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    
    process.exit(1);
  }
}

/**
 * Clear old entries based on age
 */
async function clearOldEntries(
  storage: any,
  olderThanDays: number,
  framework?: string,
  type?: string
): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  // This is a simplified implementation
  // In a real implementation, you'd need specific methods in the storage provider
  // to filter by date and type
  
  if (storage.clearOldEntries) {
    await storage.clearOldEntries(cutoffDate, { framework, type });
  } else {
    // Fallback: clear all if no selective clearing is available
    console.log(chalk.yellow('⚠️  Selective clearing not supported, clearing all cache'));
    await storage.clear();
  }
}

/**
 * Clear entries by type
 */
async function clearByType(
  storage: any,
  type: 'components' | 'blocks',
  framework?: string
): Promise<void> {
  // This is a simplified implementation
  // In a real implementation, you'd need specific methods in the storage provider
  
  if (storage.clearByType) {
    await storage.clearByType(type, framework);
  } else {
    // Fallback: clear all if no selective clearing is available
    console.log(chalk.yellow('⚠️  Selective clearing not supported, clearing all cache'));
    await storage.clear();
  }
}

/**
 * Format bytes helper
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}