/**
 * Offline mode command implementation
 */

import chalk from 'chalk';
import { getStorage, isStorageInitialized, getStorageStats } from '../../utils/storage-integration.js';
import { createSpinner } from '../utils/progress.js';
import { formatOperationResultAsJson } from '../formatters/json.js';

export interface OfflineModeOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  format?: 'table' | 'json';
}

/**
 * Manage offline mode settings
 */
export async function handleOfflineMode(options: OfflineModeOptions = {}): Promise<void> {
  const { enable, disable, status, format = 'table' } = options;
  
  if (!isStorageInitialized()) {
    const message = 'Cache system is not initialized';
    if (format === 'json') {
      console.log(formatOperationResultAsJson('offline-mode', false, { error: message }));
    } else {
      console.log(chalk.yellow('⚠️  ' + message));
    }
    return;
  }

  const storage = getStorage();

  try {
    if (status) {
      // Show current offline mode status
      await showOfflineStatus(storage, format);
    } else if (enable) {
      // Enable offline mode
      await setOfflineMode(storage, true, format);
    } else if (disable) {
      // Disable offline mode
      await setOfflineMode(storage, false, format);
    } else {
      // Toggle offline mode
      const currentStatus = await getOfflineStatus(storage);
      await setOfflineMode(storage, !currentStatus, format);
    }

  } catch (error) {
    if (format === 'json') {
      console.log(formatOperationResultAsJson('offline-mode', false, {
        error: error instanceof Error ? error.message : String(error)
      }));
    } else {
      console.error(chalk.red('❌ Error managing offline mode:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    
    process.exit(1);
  }
}

/**
 * Set offline mode on/off
 */
async function setOfflineMode(storage: any, enabled: boolean, format: string): Promise<void> {
  const spinner = createSpinner(
    enabled ? 'Enabling offline mode...' : 'Disabling offline mode...'
  ).start();

  try {
    // Check cache health before enabling offline mode
    if (enabled) {
      const stats = getStorageStats();
      const totalHits = stats ? (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0) : 0;
      const hasData = totalHits > 0;
      
      if (!hasData) {
        spinner.warn('Cache is empty');
        
        if (format === 'json') {
          console.log(formatOperationResultAsJson('offline-mode', false, {
            error: 'Cache is empty. Run refresh-cache first.',
            enabled: false
          }));
        } else {
          console.log(chalk.yellow('⚠️  Warning: Cache is empty'));
          console.log(chalk.grey('   Run refresh-cache command first to populate the cache'));
          console.log(chalk.grey('   Offline mode will have limited functionality'));
        }
        return;
      }
    }

    // Set offline mode in storage configuration
    await setStorageOfflineMode(storage, enabled);
    
    spinner.succeed(enabled ? 'Offline mode enabled' : 'Offline mode disabled');

    if (format === 'json') {
      console.log(formatOperationResultAsJson('offline-mode', true, {
        enabled,
        message: enabled ? 'Offline mode enabled' : 'Offline mode disabled'
      }));
    } else {
      if (enabled) {
        console.log(chalk.green('🔌 Offline mode enabled'));
        console.log(chalk.grey('   Using cached data only - no GitHub API calls'));
        
        // Show cache statistics
        const stats = getStorageStats();
        if (stats) {
          const totalHits = (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0);
          const totalOps = totalHits + (stats.misses || 0);
          console.log(chalk.grey(`   Available: ${totalOps} cached operations`));
          console.log(chalk.grey(`   Memory tier: ${stats.hits?.memory || 0} hits`));
          console.log(chalk.grey(`   PGLite tier: ${stats.hits?.pglite || 0} hits`));
        }
      } else {
        console.log(chalk.green('🌐 Online mode enabled'));
        console.log(chalk.grey('   Using cache with GitHub API fallback'));
      }
    }

  } catch (error) {
    spinner.fail('Failed to change offline mode');
    throw error;
  }
}

/**
 * Show current offline mode status
 */
async function showOfflineStatus(storage: any, format: string): Promise<void> {
  const spinner = createSpinner('Checking offline mode status...').start();

  try {
    const isOffline = await getOfflineStatus(storage);
    const stats = getStorageStats();
    
    spinner.succeed('Status retrieved');

    if (format === 'json') {
      console.log(JSON.stringify({
        offlineMode: isOffline,
        cacheStats: stats || {},
        ready: stats && ((stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0)) > 0
      }, null, 2));
    } else {
      console.log();
      console.log(chalk.cyan.bold('🔌 Offline Mode Status'));
      console.log(chalk.grey('═'.repeat(30)));
      console.log();
      
      const statusIcon = isOffline ? chalk.yellow('🔌') : chalk.green('🌐');
      const statusText = isOffline ? chalk.yellow('OFFLINE') : chalk.green('ONLINE');
      const modeDescription = isOffline 
        ? 'Cache only - no GitHub API calls'
        : 'Cache with GitHub API fallback';
      
      console.log(`Status: ${statusIcon} ${statusText}`);
      console.log(`Mode: ${chalk.grey(modeDescription)}`);
      console.log();
      
      // Show cache readiness
      if (stats) {
        const totalHits = (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0);
        const totalOps = totalHits + (stats.misses || 0);
        const ready = totalOps > 0;
        
        console.log(`Cache Ready: ${ready ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`Total Operations: ${totalOps}`);
        console.log(`  Memory Hits: ${stats.hits?.memory || 0}`);
        console.log(`  PGLite Hits: ${stats.hits?.pglite || 0}`);
        console.log(`  GitHub Hits: ${stats.hits?.github || 0}`);
        console.log(`  Misses: ${stats.misses || 0}`);
        
        if (isOffline && !ready) {
          console.log();
          console.log(chalk.yellow('⚠️  Warning: Offline mode enabled but cache is empty'));
          console.log(chalk.grey('   Disable offline mode or run refresh-cache to populate'));
        }
      }
    }

  } catch (error) {
    spinner.fail('Failed to get status');
    throw error;
  }
}

/**
 * Get current offline mode status from storage
 */
async function getOfflineStatus(storage: any): Promise<boolean> {
  try {
    // Check if storage has offline mode configuration
    if (storage.getConfig && storage.getConfig().github) {
      return !storage.getConfig().github.enabled;
    }
    
    // Check environment variable as fallback
    return process.env.STORAGE_GITHUB_ENABLED === 'false';
  } catch (error) {
    // Default to online mode if unable to determine
    return false;
  }
}

/**
 * Set offline mode in storage configuration
 */
async function setStorageOfflineMode(storage: any, enabled: boolean): Promise<void> {
  try {
    // Update storage configuration if possible
    if (storage.updateConfig) {
      await storage.updateConfig({
        github: { enabled: !enabled }
      });
    }
    
    // Set environment variable for future sessions
    process.env.STORAGE_GITHUB_ENABLED = enabled ? 'false' : 'true';
    
    // If the storage has a method to toggle GitHub API usage, call it
    if (storage.setGitHubEnabled) {
      await storage.setGitHubEnabled(!enabled);
    }
    
  } catch (error) {
    throw new Error(`Failed to set offline mode: ${error instanceof Error ? error.message : String(error)}`);
  }
}