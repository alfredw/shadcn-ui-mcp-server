/**
 * Cache inspection command implementation
 */

import chalk from 'chalk';
import { getStorage, isStorageInitialized } from '../../utils/storage-integration.js';
import { createKeyValueTable, createListTable } from '../formatters/table.js';
import { formatCacheItemAsJson, formatComponentListAsJson, formatBlockListAsJson } from '../formatters/json.js';
import { createSpinner } from '../utils/progress.js';

export interface InspectCacheOptions {
  key?: string;
  pattern?: string;
  type?: 'components' | 'blocks' | 'all';
  framework?: string;
  format?: 'table' | 'json';
  limit?: number;
}

/**
 * Inspect cache contents
 */
export async function handleInspectCache(options: InspectCacheOptions = {}): Promise<void> {
  const { key, pattern, type = 'all', framework, format = 'table', limit = 20 } = options;
  
  if (!isStorageInitialized()) {
    const message = 'Cache system is not initialized';
    if (format === 'json') {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.log(chalk.yellow('⚠️  ' + message));
    }
    return;
  }

  const storage = getStorage();
  const spinner = createSpinner('Inspecting cache...').start();

  try {
    if (key) {
      // Inspect specific key
      await inspectSpecificKey(storage, key, format);
    } else if (pattern) {
      // Inspect keys matching pattern
      await inspectByPattern(storage, pattern, format, limit);
    } else {
      // List items by type and framework
      await listCacheItems(storage, type, framework, format, limit);
    }
    
    spinner.succeed('Cache inspection complete');

  } catch (error) {
    spinner.fail('Cache inspection failed');
    
    if (format === 'json') {
      console.log(JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 2));
    } else {
      console.error(chalk.red('❌ Error during cache inspection:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    
    process.exit(1);
  }
}

/**
 * Inspect a specific cache key
 */
async function inspectSpecificKey(storage: any, key: string, format: string): Promise<void> {
  try {
    const item = await storage.get(key);
    
    if (item === undefined) {
      if (format === 'json') {
        console.log(JSON.stringify({ error: 'Key not found', key }, null, 2));
      } else {
        console.log(chalk.yellow(`❌ Key not found: ${key}`));
      }
      return;
    }

    // Get metadata if available
    const metadata = await getItemMetadata(storage, key);

    if (format === 'json') {
      console.log(formatCacheItemAsJson({
        key,
        data: item,
        ...metadata
      }));
    } else {
      console.log();
      console.log(chalk.cyan.bold(`🔍 Cache Item: ${key}`));
      console.log(chalk.grey('═'.repeat(50)));
      console.log();
      
      if (metadata) {
        console.log(createKeyValueTable(metadata));
        console.log();
      }
      
      console.log(chalk.cyan.bold('📄 Content:'));
      console.log(chalk.grey('─'.repeat(20)));
      
      if (typeof item === 'string') {
        // Truncate long strings for readability
        const content = item.length > 500 ? item.substring(0, 500) + '...' : item;
        console.log(content);
      } else {
        console.log(JSON.stringify(item, null, 2));
      }
    }

  } catch (error) {
    throw new Error(`Failed to inspect key ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Inspect keys matching a pattern
 */
async function inspectByPattern(storage: any, pattern: string, format: string, limit: number): Promise<void> {
  try {
    const keys = await storage.keys(pattern);
    
    if (keys.length === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({ pattern, matches: [] }, null, 2));
      } else {
        console.log(chalk.yellow(`No keys found matching pattern: ${pattern}`));
      }
      return;
    }

    const limitedKeys = keys.slice(0, limit);
    const items = [];

    for (const key of limitedKeys) {
      try {
        const item = await storage.get(key);
        const metadata = await getItemMetadata(storage, key);
        
        items.push({
          key,
          data: item,
          ...metadata
        });
      } catch (error) {
        // Skip items that can't be read
        console.log(chalk.grey(`   Skipped ${key}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    if (format === 'json') {
      console.log(JSON.stringify({
        pattern,
        totalMatches: keys.length,
        showing: items.length,
        items
      }, null, 2));
    } else {
      console.log();
      console.log(chalk.cyan.bold(`🔍 Keys matching pattern: ${pattern}`));
      console.log(chalk.grey(`Found ${keys.length} matches, showing first ${limitedKeys.length}`));
      console.log(chalk.grey('═'.repeat(60)));
      console.log();
      
      items.forEach((item, index) => {
        console.log(chalk.yellow(`${index + 1}. ${item.key}`));
        
        if (item.size) {
          console.log(chalk.grey(`   Size: ${formatBytes(item.size)}`));
        }
        
        if (item.lastAccessed) {
          console.log(chalk.grey(`   Last accessed: ${formatDate(item.lastAccessed)}`));
        }
        
        console.log();
      });
      
      if (keys.length > limit) {
        console.log(chalk.grey(`... and ${keys.length - limit} more items`));
        console.log(chalk.grey(`Use --limit ${keys.length} to see all items`));
      }
    }

  } catch (error) {
    throw new Error(`Failed to inspect pattern ${pattern}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * List cache items by type and framework
 */
async function listCacheItems(
  storage: any,
  type: string,
  framework: string | undefined,
  format: string,
  limit: number
): Promise<void> {
  try {
    const components: any[] = [];
    const blocks: any[] = [];

    // Get all keys and filter
    const allKeys = await storage.keys('*');
    
    for (const key of allKeys.slice(0, limit * 2)) { // Get more keys to filter
      const parts = key.split(':');
      if (parts.length < 3) continue;

      const [itemType, itemFramework, itemName] = parts;
      
      // Filter by framework if specified
      if (framework && itemFramework !== framework) continue;
      
      try {
        const metadata = await getItemMetadata(storage, key);
        const item = {
          key,
          name: itemName,
          framework: itemFramework,
          type: itemType,
          ...metadata
        };

        if (itemType === 'component' && (type === 'all' || type === 'components')) {
          components.push(item);
        } else if (itemType === 'block' && (type === 'all' || type === 'blocks')) {
          blocks.push(item);
        }
      } catch (error) {
        // Skip items with errors
        continue;
      }
    }

    // Limit results
    const limitedComponents = components.slice(0, limit);
    const limitedBlocks = blocks.slice(0, limit);

    if (format === 'json') {
      const result: any = {
        type,
        framework: framework || 'all'
      };
      
      if (type === 'all' || type === 'components') {
        result.components = formatComponentListAsJson(limitedComponents);
      }
      
      if (type === 'all' || type === 'blocks') {
        result.blocks = formatBlockListAsJson(limitedBlocks);
      }
      
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log();
      console.log(chalk.cyan.bold('📦 Cache Contents'));
      if (framework) {
        console.log(chalk.grey(`Framework: ${framework}`));
      }
      console.log(chalk.grey('═'.repeat(40)));
      console.log();

      if (type === 'all' || type === 'components') {
        if (limitedComponents.length > 0) {
          console.log(chalk.yellow.bold('🧩 Components:'));
          console.log(createListTable(limitedComponents, 'components'));
          
          if (components.length > limit) {
            console.log(chalk.grey(`... and ${components.length - limit} more components`));
          }
          console.log();
        } else {
          console.log(chalk.grey('No components found'));
          console.log();
        }
      }

      if (type === 'all' || type === 'blocks') {
        if (limitedBlocks.length > 0) {
          console.log(chalk.yellow.bold('🧱 Blocks:'));
          console.log(createListTable(limitedBlocks, 'blocks'));
          
          if (blocks.length > limit) {
            console.log(chalk.grey(`... and ${blocks.length - limit} more blocks`));
          }
        } else {
          console.log(chalk.grey('No blocks found'));
        }
      }
    }

  } catch (error) {
    throw new Error(`Failed to list cache items: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get metadata for a cache item
 */
async function getItemMetadata(storage: any, key: string): Promise<any> {
  try {
    // Try to get metadata from storage provider if available
    if (storage.getMetadata) {
      return await storage.getMetadata(key);
    }
    
    // Fallback: try to estimate size
    const item = await storage.get(key);
    const size = typeof item === 'string' ? item.length : JSON.stringify(item).length;
    
    return {
      size,
      estimatedSize: true
    };
  } catch (error) {
    return {};
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

/**
 * Format date helper
 */
function formatDate(date: Date | string | null): string {
  if (!date) return 'Never';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}