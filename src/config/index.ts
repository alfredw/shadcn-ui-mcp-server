/**
 * Configuration management system for shadcn-ui MCP server
 * 
 * Provides hierarchical configuration loading from multiple sources:
 * - Default configuration
 * - Configuration files 
 * - Environment variables
 * - Runtime updates
 */

export * from './schemas.js';
export * from './manager.js';
export * from './profiles.js';
export * from './sources/index.js';
export * from './validators/index.js';

// Re-export commonly used types
export type {
  CacheConfiguration,
  ConfigSource,
  ConfigValidator,
  ConfigWatcher,
  ValidationResult,
  AlertConfig
} from './schemas.js';

export { ConfigurationManager } from './manager.js';
export { ConfigurationProfiles } from './profiles.js';