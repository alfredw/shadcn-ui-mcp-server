/**
 * Configuration Manager Tests
 * Tests the intent and behavior of configuration loading, validation, and management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigurationManager } from '../../src/config/manager.js';
import { CacheConfiguration } from '../../src/config/schemas.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock file system for testing
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn()
  }
}));

const mockedFs = vi.mocked(fs);

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(() => {
    configManager = new ConfigurationManager();
    originalEnv = { ...process.env };
    
    // Reset mocks
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Configuration Loading Intent', () => {
    it('should load default configuration when no other sources exist', async () => {
      // Setup: No config file, no env vars
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      
      await configManager.load();
      const config = configManager.getAll();
      
      // Intent: Default configuration should be loaded
      expect(config.storage.type).toBe('hybrid');
      expect(config.storage.memory?.enabled).toBe(true);
      expect(config.storage.pglite?.enabled).toBe(true);
      expect(config.cache.strategy).toBe('read-through');
    });

    it('should merge environment variables with defaults correctly', async () => {
      // Setup: Set environment variables
      process.env.SHADCN_MCP_STORAGE_TYPE = 'memory-only';
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '100MB';
      process.env.SHADCN_MCP_OFFLINE = 'true';
      
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      
      await configManager.load();
      const config = configManager.getAll();
      
      // Intent: Environment variables should override defaults
      expect(config.storage.type).toBe('memory-only');
      expect(config.storage.memory?.maxSize).toBe(100 * 1024 * 1024);
      expect(config.features.offlineMode).toBe(true);
      
      // Intent: Non-overridden values should remain as defaults
      expect(config.cache.strategy).toBe('read-through');
      expect(config.monitoring.enabled).toBe(true);
    });

    it('should load and merge configuration file with defaults', async () => {
      const fileConfig = {
        storage: {
          type: 'pglite-only' as const,
          pglite: {
            maxSize: 200 * 1024 * 1024
          }
        },
        cache: {
          strategy: 'write-through' as const
        }
      };
      
      // Setup: Mock config file exists
      mockedFs.access.mockResolvedValueOnce(undefined);
      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(fileConfig));
      
      await configManager.load();
      const config = configManager.getAll();
      
      // Intent: File config should override defaults
      expect(config.storage.type).toBe('pglite-only');
      expect(config.storage.pglite?.maxSize).toBe(200 * 1024 * 1024);
      expect(config.cache.strategy).toBe('write-through');
      
      // Intent: Unspecified values should remain as defaults
      expect(config.monitoring.enabled).toBe(true);
      expect(config.features.migration).toBe(true);
    });

    it('should apply correct priority order: env vars > file > defaults', async () => {
      const fileConfig = {
        storage: {
          type: 'pglite-only' as const
        },
        cache: {
          strategy: 'write-behind' as const
        }
      };
      
      // Setup: File config and env vars
      process.env.SHADCN_MCP_STORAGE_TYPE = 'hybrid'; // Should override file
      // No env var for cache strategy, so file should win
      
      mockedFs.access.mockResolvedValueOnce(undefined);
      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(fileConfig));
      
      await configManager.load();
      const config = configManager.getAll();
      
      // Intent: Environment should override file
      expect(config.storage.type).toBe('hybrid');
      
      // Intent: File should override defaults when no env var
      expect(config.cache.strategy).toBe('write-behind');
    });
  });

  describe('Configuration Access Intent', () => {
    beforeEach(async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      await configManager.load();
    });

    it('should get configuration values by path correctly', () => {
      // Intent: Should retrieve values using dot notation
      expect(configManager.get('storage.type')).toBe('hybrid');
      expect(configManager.get('storage.memory.maxSize')).toBe(50 * 1024 * 1024);
      expect(configManager.get('cache.ttl.components')).toBe(7 * 24 * 60 * 60);
    });

    it('should return default value when path does not exist', () => {
      // Intent: Should provide fallback for missing paths
      expect(configManager.get('nonexistent.path', 'default')).toBe('default');
      expect(configManager.get('storage.nonexistent', 42)).toBe(42);
    });

    it('should handle array access in paths', () => {
      // Setup: Set a configuration with arrays
      configManager.set('features.experimentalFeatures', ['feature1', 'feature2']);
      
      // Intent: Should access array elements
      expect(configManager.get('features.experimentalFeatures[0]')).toBe('feature1');
      expect(configManager.get('features.experimentalFeatures[1]')).toBe('feature2');
    });
  });

  describe('Configuration Modification Intent', () => {
    beforeEach(async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      await configManager.load();
    });

    it('should update configuration values correctly', () => {
      const oldValue = configManager.get('storage.memory.maxSize');
      const newValue = 75 * 1024 * 1024;
      
      configManager.set('storage.memory.maxSize', newValue);
      
      // Intent: Value should be updated
      expect(configManager.get('storage.memory.maxSize')).toBe(newValue);
      expect(configManager.get('storage.memory.maxSize')).not.toBe(oldValue);
    });

    it('should validate configuration after changes', () => {
      // Intent: Invalid configuration should be rejected
      expect(() => {
        configManager.set('storage.memory.maxSize', -1); // Invalid: negative size
      }).toThrow();
      
      // Intent: Original value should be preserved when validation fails
      expect(configManager.get('storage.memory.maxSize')).toBe(50 * 1024 * 1024);
    });

    it('should support setting nested object values', () => {
      configManager.set('cache.compression', {
        enabled: true,
        algorithm: 'gzip' as const,
        level: 9
      });
      
      // Intent: Nested object should be set correctly
      expect(configManager.get('cache.compression.enabled')).toBe(true);
      expect(configManager.get('cache.compression.algorithm')).toBe('gzip');
      expect(configManager.get('cache.compression.level')).toBe(9);
    });
  });

  describe('Configuration Validation Intent', () => {
    beforeEach(async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      await configManager.load();
    });

    it('should validate valid configuration successfully', async () => {
      const config = configManager.getAll();
      const result = await configManager.validate(config);
      
      // Intent: Valid configuration should pass validation
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject configuration with invalid schema', async () => {
      const invalidConfig = {
        storage: {
          type: 'invalid-type', // Invalid enum value
          memory: {
            maxSize: -1 // Invalid: negative value
          }
        }
      };
      
      const result = await configManager.validate(invalidConfig);
      
      // Intent: Invalid configuration should fail validation
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should enforce business rules', async () => {
      const invalidConfig = {
        storage: {
          type: 'hybrid' as const,
          memory: {
            enabled: true,
            maxSize: 200 * 1024 * 1024
          },
          pglite: {
            enabled: true,
            maxSize: 100 * 1024 * 1024 // Smaller than memory - violates business rule
          }
        }
      };
      
      const result = await configManager.validate(invalidConfig);
      
      // Intent: Business rule violations should be caught
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes('Memory cache size must be less than PGLite'))).toBe(true);
    });
  });

  describe('Configuration Watching Intent', () => {
    beforeEach(async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      await configManager.load();
    });

    it('should notify watchers when configuration changes', () => {
      const watcher = vi.fn();
      const unwatch = configManager.watch('storage.memory.maxSize', watcher);
      
      const newValue = 75 * 1024 * 1024;
      const oldValue = configManager.get('storage.memory.maxSize');
      
      configManager.set('storage.memory.maxSize', newValue);
      
      // Intent: Watcher should be called with correct parameters
      expect(watcher).toHaveBeenCalledWith(newValue, oldValue, 'storage.memory.maxSize');
      
      // Intent: Unwatch should work
      watcher.mockClear();
      unwatch();
      configManager.set('storage.memory.maxSize', 50 * 1024 * 1024);
      expect(watcher).not.toHaveBeenCalled();
    });

    it('should support global watchers', () => {
      const globalWatcher = vi.fn();
      configManager.watch('*', globalWatcher);
      
      configManager.set('storage.memory.maxSize', 75 * 1024 * 1024);
      
      // Intent: Global watcher should be notified of any change
      expect(globalWatcher).toHaveBeenCalled();
    });
  });

  describe('Configuration Persistence Intent', () => {
    beforeEach(async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      await configManager.load();
    });

    it('should save configuration to file', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      
      await configManager.save();
      
      // Intent: Configuration should be written to file
      expect(mockedFs.writeFile).toHaveBeenCalled();
      
      const writeCall = mockedFs.writeFile.mock.calls[0];
      const savedContent = writeCall[1] as string;
      const savedConfig = JSON.parse(savedContent);
      
      // Intent: Saved configuration should match current configuration
      expect(savedConfig.storage.type).toBe('hybrid');
      expect(savedConfig.cache.strategy).toBe('read-through');
    });

    it('should export configuration to custom file', async () => {
      const customPath = '/custom/path/config.json';
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      
      await configManager.export(customPath);
      
      // Intent: Configuration should be exported to specified path
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        customPath,
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('Error Handling Intent', () => {
    it('should handle configuration loading errors gracefully', async () => {
      mockedFs.access.mockRejectedValue(new Error('File not found'));
      
      // Intent: Should not throw when loading configuration fails
      await expect(configManager.load()).resolves.not.toThrow();
      
      // Intent: Should still provide valid default configuration
      const config = configManager.getAll();
      expect(config).toBeDefined();
      expect(config.storage.type).toBe('hybrid');
    });

    it('should throw meaningful errors for invalid operations', async () => {
      // Intent: Should throw when accessing config before loading
      expect(() => configManager.get('storage.type')).toThrow(/not loaded/);
      
      // Intent: Should throw when setting invalid configuration
      await configManager.load();
      expect(() => {
        configManager.set('storage.memory.maxSize', 'invalid');
      }).toThrow();
    });
  });
});