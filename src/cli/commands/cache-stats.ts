/**
 * Cache statistics command implementation
 */

import chalk from 'chalk';
import { getStorage, isStorageInitialized, getStorageStats, getCircuitBreakerStatus } from '../../utils/storage-integration.js';
import { createStatsTable } from '../formatters/table.js';
import { formatStatsAsJson } from '../formatters/json.js';
import { createSpinner } from '../utils/progress.js';

export interface CacheStatsOptions {
  format?: 'table' | 'json';
  detailed?: boolean;
}

/**
 * Display cache statistics
 */
export async function handleCacheStats(options: CacheStatsOptions = {}): Promise<void> {
  const { format = 'table', detailed = false } = options;
  
  const spinner = createSpinner('Collecting cache statistics...').start();

  try {
    // Check if storage is initialized
    if (!isStorageInitialized()) {
      spinner.warn('Storage not initialized');
      console.log(chalk.yellow('⚠️  Cache system is not currently active.'));
      console.log(chalk.grey('Run the server first to initialize the cache system.'));
      return;
    }

    // Get storage instance and collect stats
    const storage = getStorage();
    const stats = getStorageStats();
    const circuitBreakerStatus = getCircuitBreakerStatus();

    if (!stats) {
      spinner.fail('Failed to collect statistics');
      console.log(chalk.red('❌ Unable to collect cache statistics.'));
      return;
    }

    spinner.succeed('Cache statistics collected');

    // Display results based on format
    if (format === 'json') {
      console.log(formatStatsAsJson(stats, detailed));
    } else {
      console.log();
      console.log(chalk.cyan.bold('📊 Cache Statistics'));
      console.log(chalk.grey('═'.repeat(50)));
      console.log();
      
      console.log(createStatsTable(stats));
      
      // Show circuit breaker status if available
      if (circuitBreakerStatus) {
        console.log();
        console.log(chalk.cyan.bold('🔌 Circuit Breaker Status'));
        console.log(chalk.grey('─'.repeat(30)));
        
        const statusColor = circuitBreakerStatus.state === 'CLOSED' ? chalk.green : 
                           circuitBreakerStatus.state === 'OPEN' ? chalk.red : chalk.yellow;
        
        console.log(`State: ${statusColor(circuitBreakerStatus.state)}`);
        console.log(`Requests Allowed: ${circuitBreakerStatus.isRequestAllowed ? chalk.green('Yes') : chalk.red('No')}`);
        
        if (stats.circuitBreaker?.failureCount !== undefined) {
          console.log(`Recent Failures: ${stats.circuitBreaker.failureCount}`);
        }
      }

      // Show detailed configuration if requested
      if (detailed && storage.getHybridConfig) {
        console.log();
        console.log(chalk.cyan.bold('⚙️  Configuration'));
        console.log(chalk.grey('─'.repeat(20)));
        const config = storage.getHybridConfig();
        console.log(formatStatsAsJson(config, false));
      }
    }

  } catch (error) {
    spinner.fail('Error collecting statistics');
    console.error(chalk.red('❌ Error collecting cache statistics:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    
    if (detailed) {
      console.error(chalk.grey('Full error:'), error);
    }
    
    process.exit(1);
  }
}

/**
 * Display simplified cache overview
 */
export async function handleCacheOverview(): Promise<void> {
  try {
    if (!isStorageInitialized()) {
      console.log(chalk.yellow('Cache: Not initialized'));
      return;
    }

    const stats = getStorageStats();
    if (!stats) {
      console.log(chalk.red('Cache: Unable to get statistics'));
      return;
    }

    const totalHits = (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0);
    const totalOps = totalHits + (stats.misses || 0);
    const hitRate = totalOps > 0 ? (totalHits / totalOps) * 100 : 0;
    const hitRateColor = hitRate >= 80 ? chalk.green : hitRate >= 60 ? chalk.yellow : chalk.red;
    
    console.log(`Cache: ${hitRateColor(hitRate.toFixed(1) + '%')} hit rate, ${totalOps} operations`);
    
  } catch (error) {
    console.log(chalk.red('Cache: Error'));
  }
}