/**
 * Refresh cache command implementation
 */

import chalk from 'chalk';
import { getStorage, isStorageInitialized } from '../../utils/storage-integration.js';
import { createBatchProgress, showOperationSummary } from '../utils/progress.js';
import { formatOperationResultAsJson } from '../formatters/json.js';
import { validateFrameworkSelection, getAxiosImplementation } from '../../utils/framework.js';

export interface RefreshCacheOptions {
  framework?: string;
  type?: 'components' | 'blocks' | 'all';
  component?: string;
  block?: string;
  force?: boolean;
  format?: 'table' | 'json';
}

/**
 * Refresh cache from GitHub
 */
export async function handleRefreshCache(options: RefreshCacheOptions = {}): Promise<void> {
  const { framework, type = 'all', component, block, force = false, format = 'table' } = options;
  
  if (!isStorageInitialized()) {
    const message = 'Cache system is not initialized';
    if (format === 'json') {
      console.log(formatOperationResultAsJson('refresh-cache', false, { error: message }));
    } else {
      console.log(chalk.yellow('⚠️  ' + message));
    }
    return;
  }

  try {
    // Validate framework
    if (framework) {
      process.env.FRAMEWORK = framework;
      validateFrameworkSelection();
    }

    // Get axios implementation for GitHub API
    const axios = await getAxiosImplementation();
    const storage = getStorage();

    let itemsToRefresh: Array<{ key: string; type: 'component' | 'block'; name: string }> = [];

    // Determine what to refresh
    if (component) {
      // Refresh specific component
      itemsToRefresh.push({
        key: `component:${framework || 'react'}:${component}`,
        type: 'component',
        name: component
      });
    } else if (block) {
      // Refresh specific block
      itemsToRefresh.push({
        key: `block:${framework || 'react'}:${block}`,
        type: 'block',
        name: block
      });
    } else {
      // Refresh all or by type
      itemsToRefresh = await getItemsToRefresh(storage, type, framework);
    }

    if (itemsToRefresh.length === 0) {
      const message = 'No items found to refresh';
      if (format === 'json') {
        console.log(formatOperationResultAsJson('refresh-cache', true, { message, refreshed: 0 }));
      } else {
        console.log(chalk.yellow('ℹ️  ' + message));
      }
      return;
    }

    // Start refresh operation
    const progress = createBatchProgress(itemsToRefresh.length, 'Refreshing cache from GitHub...').start();
    const startTime = Date.now();
    
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process items
    for (const item of itemsToRefresh) {
      try {
        // Fetch fresh data from GitHub
        const freshData = await fetchFromGitHub(axios, item);
        
        if (freshData) {
          // Update in cache
          await storage.set(item.key, freshData);
          progress.success(item.name);
          succeeded++;
        } else {
          progress.failure(item.name, 'No data returned');
          failed++;
          errors.push(`${item.name}: No data returned from GitHub`);
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        progress.failure(item.name, errorMessage);
        failed++;
        errors.push(`${item.name}: ${errorMessage}`);
      }
    }

    const duration = Date.now() - startTime;
    progress.complete('Cache refresh completed');

    // Show results
    if (format === 'json') {
      console.log(formatOperationResultAsJson('refresh-cache', succeeded > 0, {
        refreshed: succeeded,
        failed,
        duration,
        errors: errors.slice(0, 10) // Limit errors in JSON output
      }));
    } else {
      showOperationSummary('Cache Refresh', {
        succeeded,
        failed,
        duration
      });

      if (errors.length > 0) {
        console.log(chalk.yellow(`⚠️  ${errors.length} items failed to refresh:`));
        errors.slice(0, 5).forEach(error => {
          console.log(chalk.grey(`   • ${error}`));
        });
        
        if (errors.length > 5) {
          console.log(chalk.grey(`   ... and ${errors.length - 5} more`));
        }
      }

      if (succeeded > 0) {
        console.log(chalk.green(`✅ Successfully refreshed ${succeeded} items`));
      }
    }

  } catch (error) {
    if (format === 'json') {
      console.log(formatOperationResultAsJson('refresh-cache', false, {
        error: error instanceof Error ? error.message : String(error)
      }));
    } else {
      console.error(chalk.red('❌ Error during cache refresh:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    
    process.exit(1);
  }
}

/**
 * Get list of items to refresh from cache
 */
async function getItemsToRefresh(
  storage: any,
  type: string,
  framework?: string
): Promise<Array<{ key: string; type: 'component' | 'block'; name: string }>> {
  const items: Array<{ key: string; type: 'component' | 'block'; name: string }> = [];

  try {
    // Get all keys from storage
    const allKeys = await storage.keys('*');
    
    for (const key of allKeys) {
      const parts = key.split(':');
      if (parts.length < 3) continue;

      const [itemType, itemFramework, itemName] = parts;
      
      // Filter by framework if specified
      if (framework && itemFramework !== framework) continue;
      
      // Filter by type if specified
      if (type !== 'all') {
        if (type === 'components' && itemType !== 'component') continue;
        if (type === 'blocks' && itemType !== 'block') continue;
      }

      // Only include components and blocks
      if (itemType === 'component') {
        items.push({ key, type: 'component', name: itemName });
      } else if (itemType === 'block') {
        items.push({ key, type: 'block', name: itemName });
      }
    }
  } catch (error) {
    console.log(chalk.yellow('⚠️  Could not list cached items, will refresh common items'));
    
    // Fallback: refresh common components and blocks
    const commonComponents = ['button', 'card', 'input', 'dialog', 'dropdown-menu'];
    const commonBlocks = ['dashboard-01', 'calendar-01', 'login-01'];
    
    const targetFramework = framework || 'react';
    
    if (type === 'all' || type === 'components') {
      commonComponents.forEach(name => {
        items.push({ 
          key: `component:${targetFramework}:${name}`, 
          type: 'component', 
          name 
        });
      });
    }
    
    if (type === 'all' || type === 'blocks') {
      commonBlocks.forEach(name => {
        items.push({ 
          key: `block:${targetFramework}:${name}`, 
          type: 'block', 
          name 
        });
      });
    }
  }

  return items;
}

/**
 * Fetch data from GitHub API
 */
async function fetchFromGitHub(
  axios: any,
  item: { key: string; type: 'component' | 'block'; name: string }
): Promise<any> {
  try {
    if (item.type === 'component') {
      // Use existing tool handler logic
      const { toolHandlers } = await import('../../tools/index.js');
      const handler = toolHandlers.get_component;
      
      if (handler) {
        const result = await handler({ componentName: item.name });
        return result.content;
      }
    } else if (item.type === 'block') {
      // Use existing tool handler logic
      const { toolHandlers } = await import('../../tools/index.js');
      const handler = toolHandlers.get_block;
      
      if (handler) {
        const result = await handler({ blockName: item.name });
        return result.content;
      }
    }
    
    return null;
  } catch (error) {
    throw new Error(`Failed to fetch ${item.type} ${item.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}