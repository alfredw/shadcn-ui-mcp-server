/**
 * Configuration manager for hierarchical configuration loading and management
 */

import { 
  ConfigSource, 
  ConfigValidator, 
  ConfigWatcher, 
  CacheConfiguration,
  ValidationResult
} from './schemas.js';
import { DefaultConfigSource, FileConfigSource, EnvironmentConfigSource } from './sources/index.js';
import { SchemaValidator, BusinessRuleValidator } from './validators/index.js';

export class ConfigurationManager {
  private config: CacheConfiguration | null = null;
  private sources: ConfigSource[];
  private validators: ConfigValidator[];
  private watchers: Map<string, ConfigWatcher[]> = new Map();
  private fileSource: FileConfigSource;
  
  constructor() {
    this.fileSource = new FileConfigSource();
    
    // Initialize sources in priority order (lowest to highest)
    this.sources = [
      new DefaultConfigSource(),     // Priority 1 - base defaults
      this.fileSource,               // Priority 2 - file config
      new EnvironmentConfigSource()  // Priority 3 - env vars override all
    ];
    
    this.validators = [
      new SchemaValidator(),
      new BusinessRuleValidator()
    ];
  }
  
  /**
   * Load configuration from all sources
   */
  async load(): Promise<void> {
    try {
      // Load from all sources
      const configPromises = this.sources.map(async (source) => {
        try {
          const config = await source.load();
          return { source: source.name, config, priority: source.priority };
        } catch (error) {
          console.warn(`Failed to load config from ${source.name}:`, error);
          return { source: source.name, config: {}, priority: source.priority };
        }
      });
      
      const results = await Promise.all(configPromises);
      
      // Sort by priority and merge configurations
      results.sort((a, b) => a.priority - b.priority);
      
      let mergedConfig = {};
      for (const result of results) {
        mergedConfig = this.deepMerge(mergedConfig, result.config);
      }
      
      // Validate merged configuration
      const validation = await this.validate(mergedConfig);
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors?.join(', ')}`);
      }
      
      this.config = mergedConfig as CacheConfiguration;
      
      // Notify all watchers about the new configuration
      this.notifyWatchers('*', this.config);
      
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }
  
  /**
   * Get configuration value by path
   */
  get<T>(path: string, defaultValue?: T): T {
    if (!this.config) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error('Configuration not loaded. Call load() first.');
    }
    
    const value = this.getValueByPath(this.config, path);
    return value !== undefined ? value : (defaultValue as T);
  }
  
  /**
   * Set configuration value by path
   */
  set(path: string, value: any): void {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    
    const oldValue = this.getValueByPath(this.config, path);
    this.setValueByPath(this.config, path, value);
    
    // Validate the updated configuration
    const validation = this.validateSync(this.config);
    if (!validation.valid) {
      // Rollback the change
      this.setValueByPath(this.config, path, oldValue);
      throw new Error(`Configuration validation failed: ${validation.errors?.join(', ')}`);
    }
    
    this.notifyWatchers(path, value, oldValue);
  }
  
  /**
   * Get the complete configuration
   */
  getAll(): CacheConfiguration {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    
    return JSON.parse(JSON.stringify(this.config)); // Deep clone
  }
  
  /**
   * Watch for configuration changes
   */
  watch(path: string, callback: ConfigWatcher): () => void {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    
    this.watchers.get(path)!.push(callback);
    
    // Return unwatch function
    return () => {
      const watchers = this.watchers.get(path);
      if (watchers) {
        const index = watchers.indexOf(callback);
        if (index > -1) {
          watchers.splice(index, 1);
        }
      }
    };
  }
  
  /**
   * Save current configuration to file
   */
  async save(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    
    await this.fileSource.save(this.config);
  }
  
  /**
   * Export configuration to a specific file
   */
  async export(filePath: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    
    await this.fileSource.saveToPath(this.config, filePath);
  }
  
  /**
   * Import configuration from a specific file
   */
  async import(filePath: string): Promise<void> {
    const importedConfig = await this.fileSource.loadFromPath(filePath);
    
    // Validate imported configuration
    const validation = await this.validate(importedConfig);
    if (!validation.valid) {
      throw new Error(`Imported configuration validation failed: ${validation.errors?.join(', ')}`);
    }
    
    // Merge with current configuration (imported config takes precedence)
    if (this.config) {
      this.config = this.deepMerge(this.config, importedConfig) as CacheConfiguration;
    } else {
      // If no config loaded yet, load defaults first
      await this.load();
      this.config = this.deepMerge(this.config!, importedConfig) as CacheConfiguration;
    }
    
    this.notifyWatchers('*', this.config);
  }
  
  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    const defaultSource = new DefaultConfigSource();
    this.config = await defaultSource.load();
    
    this.notifyWatchers('*', this.config);
  }
  
  /**
   * Validate configuration
   */
  async validate(config: Partial<CacheConfiguration>): Promise<ValidationResult> {
    for (const validator of this.validators) {
      const result = validator.validate(config);
      if (!result.valid) {
        return result;
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Synchronous validation (for performance-critical paths)
   */
  private validateSync(config: Partial<CacheConfiguration>): ValidationResult {
    for (const validator of this.validators) {
      const result = validator.validate(config);
      if (!result.valid) {
        return result;
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Get value by dot-notation path
   */
  private getValueByPath(obj: any, path: string): any {
    if (path === '*') {
      return obj;
    }
    
    return path.split('.').reduce((current, key) => {
      // Handle array indices
      if (key.includes('[') && key.includes(']')) {
        const [arrayKey, indexStr] = key.split('[');
        const index = parseInt(indexStr.replace(']', ''), 10);
        return current?.[arrayKey]?.[index];
      }
      
      return current?.[key];
    }, obj);
  }
  
  /**
   * Set value by dot-notation path
   */
  private setValueByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    
    const target = keys.reduce((current, key) => {
      // Handle array indices
      if (key.includes('[') && key.includes(']')) {
        const [arrayKey, indexStr] = key.split('[');
        const index = parseInt(indexStr.replace(']', ''), 10);
        
        if (!current[arrayKey]) {
          current[arrayKey] = [];
        }
        
        if (!current[arrayKey][index]) {
          current[arrayKey][index] = {};
        }
        
        return current[arrayKey][index];
      }
      
      if (!current[key]) {
        current[key] = {};
      }
      
      return current[key];
    }, obj);
    
    // Handle array index in last key
    if (lastKey.includes('[') && lastKey.includes(']')) {
      const [arrayKey, indexStr] = lastKey.split('[');
      const index = parseInt(indexStr.replace(']', ''), 10);
      
      if (!target[arrayKey]) {
        target[arrayKey] = [];
      }
      
      target[arrayKey][index] = value;
    } else {
      target[lastKey] = value;
    }
  }
  
  /**
   * Deep merge two configuration objects
   */
  private deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) {
      return target;
    }
    
    if (typeof source !== 'object' || Array.isArray(source)) {
      return source;
    }
    
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && 
            source[key] !== null && 
            !Array.isArray(source[key]) &&
            typeof target[key] === 'object' && 
            target[key] !== null && 
            !Array.isArray(target[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }
  
  /**
   * Notify watchers about configuration changes
   */
  private notifyWatchers(path: string, newValue: any, oldValue?: any): void {
    // Notify specific path watchers
    const pathWatchers = this.watchers.get(path) || [];
    pathWatchers.forEach(watcher => {
      try {
        watcher(newValue, oldValue, path);
      } catch (error) {
        console.error(`Error in configuration watcher for path ${path}:`, error);
      }
    });
    
    // Notify global watchers (path === '*')
    if (path !== '*') {
      const globalWatchers = this.watchers.get('*') || [];
      globalWatchers.forEach(watcher => {
        try {
          watcher(newValue, oldValue, path);
        } catch (error) {
          console.error(`Error in global configuration watcher:`, error);
        }
      });
    }
  }
}