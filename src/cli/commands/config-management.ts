/**
 * Configuration management CLI commands
 */

import chalk from 'chalk';
import { promises as fs } from 'fs';
import { getConfigurationManager } from '../../utils/storage-integration.js';
import { ConfigurationProfiles } from '../../config/profiles.js';
import { formatAsTable, formatAsJson } from '../formatters/index.js';

interface ConfigOptions {
  format?: 'table' | 'json';
}

interface ConfigSetOptions extends ConfigOptions {
  validate?: boolean;
}

interface ConfigProfileOptions extends ConfigOptions {
  list?: boolean;
  describe?: boolean;
}

interface ConfigExportOptions extends ConfigOptions {
  file?: string;
  pretty?: boolean;
}

interface ConfigImportOptions extends ConfigOptions {
  file: string;
  merge?: boolean;
  validate?: boolean;
}

/**
 * Show current configuration or specific path
 */
export async function handleConfigShow(path?: string, options: ConfigOptions = {}): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    await configManager.load();
    
    let config: any;
    let displayPath = path || 'complete configuration';
    
    if (path) {
      config = configManager.get(path);
      if (config === undefined) {
        console.error(chalk.red(`❌ Configuration path '${path}' not found`));
        process.exit(1);
      }
    } else {
      config = configManager.getAll();
    }
    
    const format = options.format || 'json';
    
    if (format === 'table' && typeof config === 'object' && !Array.isArray(config)) {
      console.log(chalk.cyan.bold(`\n📋 Configuration: ${displayPath}\n`));
      
      // Flatten object for table display
      const flattened = flattenObject(config, path || '');
      const tableData = Object.entries(flattened).map(([key, value]) => ({
        'Path': key,
        'Value': formatValue(value),
        'Type': typeof value
      }));
      
      console.log(formatAsTable(tableData));
    } else {
      console.log(chalk.cyan.bold(`\n📋 Configuration: ${displayPath}\n`));
      console.log(formatAsJson(config));
    }
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to show configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Set configuration value
 */
export async function handleConfigSet(path: string, value: string, options: ConfigSetOptions = {}): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    await configManager.load();
    
    // Parse the value
    let parsedValue: any;
    try {
      // Try parsing as JSON first
      parsedValue = JSON.parse(value);
    } catch {
      // If not valid JSON, treat as string
      parsedValue = value;
    }
    
    // Get old value for display
    const oldValue = configManager.get(path);
    
    // Set the new value (this will validate automatically)
    configManager.set(path, parsedValue);
    
    // Save to file
    await configManager.save();
    
    console.log(chalk.green(`✅ Configuration updated successfully`));
    console.log(chalk.gray(`   Path: ${path}`));
    console.log(chalk.gray(`   Old value: ${formatValue(oldValue)}`));
    console.log(chalk.gray(`   New value: ${formatValue(parsedValue)}`));
    
    // Optionally validate the entire configuration
    if (options.validate) {
      const validation = await configManager.validate(configManager.getAll());
      if (validation.valid) {
        console.log(chalk.green(`✅ Configuration validation passed`));
      } else {
        console.log(chalk.yellow(`⚠️  Configuration validation warnings:`));
        validation.errors?.forEach(error => {
          console.log(chalk.yellow(`   - ${error}`));
        });
      }
    }
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to set configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Apply configuration profile
 */
export async function handleConfigProfile(name?: string, options: ConfigProfileOptions = {}): Promise<void> {
  try {
    const profiles = new ConfigurationProfiles();
    
    if (options.list || !name) {
      // List available profiles
      const profileNames = profiles.getProfileNames();
      
      console.log(chalk.cyan.bold('\n📁 Available Configuration Profiles\n'));
      
      const tableData = profileNames.map(profileName => ({
        'Profile': profileName,
        'Description': profiles.getProfileDescription(profileName)
      }));
      
      console.log(formatAsTable(tableData));
      
      if (!name) {
        return;
      }
    }
    
    if (options.describe && name) {
      // Show profile details
      const profile = profiles.getProfile(name);
      if (!profile) {
        console.error(chalk.red(`❌ Profile '${name}' not found`));
        process.exit(1);
      }
      
      console.log(chalk.cyan.bold(`\n📋 Profile: ${name}\n`));
      console.log(chalk.gray(profiles.getProfileDescription(name)));
      console.log(chalk.cyan('\nProfile Configuration:\n'));
      console.log(formatAsJson(profile));
      return;
    }
    
    if (name) {
      // Apply profile
      if (!profiles.hasProfile(name)) {
        console.error(chalk.red(`❌ Profile '${name}' not found`));
        console.log(chalk.gray('\nAvailable profiles:'));
        profiles.getProfileNames().forEach(p => {
          console.log(chalk.gray(`  - ${p}`));
        });
        process.exit(1);
      }
      
      const configManager = getConfigurationManager();
      await configManager.load();
      
      const currentConfig = configManager.getAll();
      const newConfig = profiles.applyProfile(name, currentConfig);
      
      // Reset and load new configuration
      await configManager.reset();
      await configManager.import(await createTempConfigFile(newConfig));
      
      console.log(chalk.green(`✅ Applied profile: ${name}`));
      console.log(chalk.gray(`   Description: ${profiles.getProfileDescription(name)}`));
      
      // Save the new configuration
      await configManager.save();
      console.log(chalk.green(`✅ Configuration saved`));
    }
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to manage profiles: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Validate current configuration
 */
export async function handleConfigValidate(options: ConfigOptions = {}): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    await configManager.load();
    
    const config = configManager.getAll();
    const validation = await configManager.validate(config);
    
    if (validation.valid) {
      console.log(chalk.green(`✅ Configuration validation passed`));
      console.log(chalk.gray(`   All configuration values are valid`));
    } else {
      console.log(chalk.red(`❌ Configuration validation failed`));
      console.log(chalk.red(`\nErrors found:`));
      
      validation.errors?.forEach((error, index) => {
        console.log(chalk.red(`   ${index + 1}. ${error}`));
      });
      
      process.exit(1);
    }
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to validate configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Export configuration to file
 */
export async function handleConfigExport(options: ConfigExportOptions = {}): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    await configManager.load();
    
    const config = configManager.getAll();
    const outputFile = options.file || 'shadcn-mcp-config-export.json';
    
    const content = options.pretty ? 
      JSON.stringify(config, null, 2) : 
      JSON.stringify(config);
    
    await fs.writeFile(outputFile, content, 'utf-8');
    
    console.log(chalk.green(`✅ Configuration exported successfully`));
    console.log(chalk.gray(`   File: ${outputFile}`));
    console.log(chalk.gray(`   Size: ${(content.length / 1024).toFixed(2)} KB`));
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to export configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Import configuration from file
 */
export async function handleConfigImport(options: ConfigImportOptions): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    
    if (!options.merge) {
      await configManager.load();
    }
    
    await configManager.import(options.file);
    
    if (options.validate) {
      const validation = await configManager.validate(configManager.getAll());
      if (!validation.valid) {
        console.log(chalk.red(`❌ Imported configuration validation failed:`));
        validation.errors?.forEach(error => {
          console.log(chalk.red(`   - ${error}`));
        });
        process.exit(1);
      }
    }
    
    await configManager.save();
    
    console.log(chalk.green(`✅ Configuration imported successfully`));
    console.log(chalk.gray(`   File: ${options.file}`));
    console.log(chalk.gray(`   Mode: ${options.merge ? 'merged' : 'replaced'}`));
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to import configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Reset configuration to defaults
 */
export async function handleConfigReset(options: ConfigOptions = {}): Promise<void> {
  try {
    const configManager = getConfigurationManager();
    await configManager.reset();
    await configManager.save();
    
    console.log(chalk.green(`✅ Configuration reset to defaults`));
    console.log(chalk.gray(`   All custom settings have been cleared`));
    
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to reset configuration: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Helper function to flatten nested objects for table display
 */
function flattenObject(obj: any, prefix: string = ''): Record<string, any> {
  const flattened: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value, path));
    } else {
      flattened[path] = value;
    }
  }
  
  return flattened;
}

/**
 * Format value for display
 */
function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return '{object}';
  return String(value);
}

/**
 * Create a temporary config file for profile application
 */
async function createTempConfigFile(config: any): Promise<string> {
  const tempFile = `/tmp/shadcn-mcp-temp-${Date.now()}.json`;
  await fs.writeFile(tempFile, JSON.stringify(config, null, 2), 'utf-8');
  return tempFile;
}