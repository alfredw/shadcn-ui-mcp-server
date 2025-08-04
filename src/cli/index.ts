/**
 * CLI command registry and setup
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { handleCacheStats } from './commands/cache-stats.js';
import { handleClearCache } from './commands/clear-cache.js';
import { handleRefreshCache } from './commands/refresh-cache.js';
import { handleInspectCache } from './commands/inspect-cache.js';
import { handleOfflineMode } from './commands/offline-mode.js';
import { 
  handleConfigShow,
  handleConfigSet,
  handleConfigProfile,
  handleConfigValidate,
  handleConfigExport,
  handleConfigImport,
  handleConfigReset
} from './commands/config-management.js';

/**
 * Setup cache-related CLI commands
 */
export function setupCacheCommands(program: Command): void {
  // Cache management command group
  const cache = program
    .command('cache')
    .description('Cache management commands');

  // Cache stats command
  cache
    .command('stats')
    .description('Display cache statistics and metrics')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .option('-d, --detailed', 'show detailed statistics')
    .option('-l, --latency', 'show response time percentiles (p50, p95, p99)')
    .option('-h, --history <count>', 'show last N operations history', parseInt)
    .action(async (options) => {
      await handleCacheStats(options);
    });

  // Clear cache command
  cache
    .command('clear')
    .description('Clear cache data')
    .option('--framework <name>', 'clear specific framework (react|svelte)')
    .option('--type <type>', 'clear specific type (components|blocks|all)', 'all')
    .option('--older-than <days>', 'clear items older than N days', parseInt)
    .option('-f, --force', 'skip confirmation prompt')
    .option('--format <format>', 'output format (table|json)', 'table')
    .action(async (options) => {
      await handleClearCache(options);
    });

  // Refresh cache command
  cache
    .command('refresh')
    .description('Refresh cache from GitHub')
    .option('--framework <name>', 'refresh specific framework (react|svelte)')
    .option('--type <type>', 'refresh specific type (components|blocks|all)', 'all')
    .option('--component <name>', 'refresh specific component')
    .option('--block <name>', 'refresh specific block')
    .option('-f, --force', 'force refresh even if not stale')
    .option('--format <format>', 'output format (table|json)', 'table')
    .action(async (options) => {
      await handleRefreshCache(options);
    });

  // Inspect cache command
  cache
    .command('inspect [key]')
    .description('Inspect cache contents')
    .option('--pattern <pattern>', 'inspect keys matching pattern')
    .option('--type <type>', 'filter by type (components|blocks|all)', 'all')
    .option('--framework <name>', 'filter by framework (react|svelte)')
    .option('--limit <number>', 'limit number of results', parseInt, 20)
    .option('--format <format>', 'output format (table|json)', 'table')
    .action(async (key, options) => {
      await handleInspectCache({ key, ...options });
    });

  // Offline mode command
  cache
    .command('offline')
    .description('Manage offline mode')
    .option('--enable', 'enable offline mode')
    .option('--disable', 'disable offline mode')
    .option('--status', 'show current status')
    .option('--format <format>', 'output format (table|json)', 'table')
    .action(async (options) => {
      await handleOfflineMode(options);
    });

  // Configuration management commands
  const config = cache
    .command('config')
    .description('Configuration management commands');

  config
    .command('show [path]')
    .description('Show current configuration or specific path')
    .option('-f, --format <format>', 'output format (table|json)', 'json')
    .action(async (path, options) => {
      await handleConfigShow(path, options);
    });

  config
    .command('set <path> <value>')
    .description('Set configuration value')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .option('--validate', 'validate configuration after setting')
    .action(async (path, value, options) => {
      await handleConfigSet(path, value, options);
    });

  config
    .command('profile [name]')
    .description('Apply configuration profile')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .option('-l, --list', 'list available profiles')
    .option('-d, --describe', 'describe profile configuration')
    .action(async (name, options) => {
      await handleConfigProfile(name, options);
    });

  config
    .command('validate')
    .description('Validate current configuration')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .action(async (options) => {
      await handleConfigValidate(options);
    });

  config
    .command('export [file]')
    .description('Export configuration to file')
    .option('-f, --format <format>', 'output format (table|json)', 'json')
    .option('--pretty', 'pretty-print JSON output')
    .action(async (file, options) => {
      await handleConfigExport({ ...options, file });
    });

  config
    .command('import <file>')
    .description('Import configuration from file')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .option('--merge', 'merge with existing configuration')
    .option('--validate', 'validate configuration after import')
    .action(async (file, options) => {
      await handleConfigImport({ ...options, file });
    });

  config
    .command('reset')
    .description('Reset configuration to defaults')
    .option('-f, --format <format>', 'output format (table|json)', 'table')
    .action(async (options) => {
      await handleConfigReset(options);
    });
}

/**
 * Setup direct cache flags on main command (alternative syntax)
 */
export function setupCacheFlags(program: Command): void {
  program
    .option('--cache-stats', 'display cache statistics')
    .option('--clear-cache', 'clear all cache data')
    .option('--refresh-cache', 'refresh cache from GitHub')
    .option('--offline-only', 'enable offline mode (cache only)')
    .option('--cache-format <format>', 'cache command output format', 'table');
}

/**
 * Handle direct cache flags (called from main command action)
 */
export async function handleCacheFlags(options: any): Promise<boolean> {
  let handled = false;

  if (options.cacheStats) {
    await handleCacheStats({ format: options.cacheFormat });
    handled = true;
  }

  if (options.clearCache) {
    await handleClearCache({ force: true, format: options.cacheFormat });
    handled = true;
  }

  if (options.refreshCache) {
    await handleRefreshCache({ format: options.cacheFormat });
    handled = true;
  }

  if (options.offlineOnly) {
    await handleOfflineMode({ enable: true, format: options.cacheFormat });
    handled = true;
  }

  return handled;
}

/**
 * Check if arguments indicate cache command usage
 */
export function isCacheCommand(args: string[]): boolean {
  // Check for cache subcommand
  if (args.includes('cache')) {
    return true;
  }

  // Check for direct cache flags
  const cacheFlags = [
    '--cache-stats',
    '--clear-cache', 
    '--refresh-cache',
    '--offline-only'
  ];

  return cacheFlags.some(flag => args.includes(flag));
}

/**
 * Show cache command help
 */
export function showCacheHelp(): void {
  console.log(`
${chalk.cyan.bold('Cache Management Commands')}

${chalk.yellow('Subcommands:')}
  cache stats                    Display cache statistics
  cache clear                    Clear cache data with filters
  cache refresh                  Refresh cache from GitHub
  cache inspect [key]            Inspect cache contents
  cache offline                  Manage offline mode

${chalk.yellow('Direct flags:')}
  --cache-stats                  Display cache statistics
  --clear-cache                  Clear all cache data
  --refresh-cache                Refresh cache from GitHub
  --offline-only                 Enable offline mode

${chalk.yellow('Options:')}
  --format <format>              Output format: table or json
  --framework <framework>        Target framework: react or svelte
  --force                        Skip confirmation prompts

${chalk.yellow('Examples:')}
  ${chalk.grey('npx shadcn-mcp cache stats')}
  ${chalk.grey('npx shadcn-mcp cache clear --framework react')}
  ${chalk.grey('npx shadcn-mcp cache refresh --type components')}
  ${chalk.grey('npx shadcn-mcp cache inspect component:react:button')}
  ${chalk.grey('npx shadcn-mcp --cache-stats --format json')}
  ${chalk.grey('npx shadcn-mcp --clear-cache --force')}

${chalk.yellow('For more help:')}
  ${chalk.grey('npx shadcn-mcp cache <command> --help')}
`);
}