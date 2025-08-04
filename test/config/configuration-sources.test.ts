/**
 * Configuration Sources Tests
 * Tests the intent and behavior of different configuration sources
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DefaultConfigSource, EnvironmentConfigSource, FileConfigSource } from '../../src/config/sources/index.js';
import { promises as fs } from 'fs';

// Mock file system
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn()
  }
}));

const mockedFs = vi.mocked(fs);

describe('Configuration Sources', () => {
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  describe('DefaultConfigSource Intent', () => {
    let defaultSource: DefaultConfigSource;
    
    beforeEach(() => {
      defaultSource = new DefaultConfigSource();
    });

    it('should provide complete default configuration', async () => {
      const config = await defaultSource.load();
      
      // Intent: Should provide all required configuration sections
      expect(config.storage).toBeDefined();
      expect(config.cache).toBeDefined();
      expect(config.performance).toBeDefined();
      expect(config.monitoring).toBeDefined();
      expect(config.circuitBreaker).toBeDefined();
      expect(config.features).toBeDefined();
    });

    it('should provide sensible default values', async () => {
      const config = await defaultSource.load();
      
      // Intent: Storage defaults should be practical
      expect(config.storage.type).toBe('hybrid');
      expect(config.storage.memory?.enabled).toBe(true);
      expect(config.storage.pglite?.enabled).toBe(true);
      expect(config.storage.memory?.maxSize).toBeGreaterThan(0);
      
      // Intent: Cache strategy should be safe default
      expect(config.cache.strategy).toBe('read-through');
      
      // Intent: TTL values should be reasonable
      expect(config.cache.ttl.components).toBeGreaterThan(0);
      expect(config.cache.ttl.metadata).toBeLessThan(config.cache.ttl.components);
      
      // Intent: Monitoring should be enabled by default
      expect(config.monitoring.enabled).toBe(true);
      
      // Intent: Features should have safe defaults
      expect(config.features.migration).toBe(true);
      expect(config.features.offlineMode).toBe(false);
    });

    it('should have lowest priority', () => {
      // Intent: Default source should have lowest priority
      expect(defaultSource.priority).toBe(1);
    });
  });

  describe('EnvironmentConfigSource Intent', () => {
    let envSource: EnvironmentConfigSource;
    
    beforeEach(() => {
      envSource = new EnvironmentConfigSource();
    });

    it('should load storage type from environment', async () => {
      process.env.SHADCN_MCP_STORAGE_TYPE = 'memory-only';
      
      const config = await envSource.load();
      
      // Intent: Should read storage type from environment
      expect(config.storage?.type).toBe('memory-only');
    });

    it('should parse byte sizes correctly', async () => {
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '100MB';
      process.env.SHADCN_MCP_DB_MAX_SIZE = '2GB';
      
      const config = await envSource.load();
      
      // Intent: Should convert size strings to bytes
      expect(config.storage?.memory?.maxSize).toBe(100 * 1024 * 1024);
      expect(config.storage?.pglite?.maxSize).toBe(2 * 1024 * 1024 * 1024);
    });

    it('should handle boolean environment variables', async () => {
      process.env.SHADCN_MCP_OFFLINE = 'true';
      process.env.SHADCN_MCP_MEMORY_ENABLED = 'false';
      process.env.SHADCN_MCP_ENABLE_MIGRATION = 'false';
      
      const config = await envSource.load();
      
      // Intent: Should convert string booleans correctly
      expect(config.features?.offlineMode).toBe(true);
      expect(config.storage?.memory?.enabled).toBe(false);
      expect(config.features?.migration).toBe(false);
    });

    it('should handle numeric environment variables', async () => {
      process.env.SHADCN_MCP_GITHUB_TIMEOUT = '45000';
      process.env.SHADCN_MCP_BATCH_SIZE = '200';
      process.env.SHADCN_MCP_TTL_COMPONENTS = '1209600'; // 14 days
      
      const config = await envSource.load();
      
      // Intent: Should parse numbers correctly
      expect(config.storage?.github?.timeout).toBe(45000);
      expect(config.performance?.batchSize).toBe(200);
      expect(config.cache?.ttl?.components).toBe(1209600);
    });

    it('should support GitHub token from multiple env vars', async () => {
      // Test GITHUB_TOKEN
      process.env.GITHUB_TOKEN = 'ghp_from_github_token';
      delete process.env.SHADCN_MCP_GITHUB_TOKEN;
      
      let config = await envSource.load();
      expect(config.storage?.github?.token).toBe('ghp_from_github_token');
      
      // Test SHADCN_MCP_GITHUB_TOKEN (should override)
      process.env.SHADCN_MCP_GITHUB_TOKEN = 'ghp_from_shadcn_token';
      
      config = await envSource.load();
      expect(config.storage?.github?.token).toBe('ghp_from_shadcn_token');
    });

    it('should handle experimental features as comma-separated list', async () => {
      process.env.SHADCN_MCP_EXPERIMENTAL_FEATURES = 'feature1,feature2, feature3';
      
      const config = await envSource.load();
      
      // Intent: Should split and trim feature list
      expect(config.features?.experimentalFeatures).toEqual(['feature1', 'feature2', 'feature3']);
    });

    it('should have high priority', () => {
      // Intent: Environment source should override files
      expect(envSource.priority).toBe(3);
    });

    it('should return empty config when no env vars set', async () => {
      // Clear all relevant env vars
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('SHADCN_MCP_') || key === 'GITHUB_TOKEN') {
          delete process.env[key];
        }
      });
      
      const config = await envSource.load();
      
      // Intent: Should return empty partial config
      expect(Object.keys(config)).toHaveLength(0);
    });
  });

  describe('FileConfigSource Intent', () => {
    let fileSource: FileConfigSource;
    
    beforeEach(() => {
      fileSource = new FileConfigSource();
    });

    it('should load configuration from first available file', async () => {
      const configData = {
        storage: { type: 'pglite-only' },
        cache: { strategy: 'write-through' }
      };
      
      // Setup: First path fails, second succeeds
      mockedFs.access
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce(undefined);
      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(configData));
      
      const config = await fileSource.load();
      
      // Intent: Should load from first available file
      expect(config).toEqual(configData);
    });

    it('should return empty config when no files exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('Not found'));
      
      const config = await fileSource.load();
      
      // Intent: Should return empty config if no files found
      expect(config).toEqual({});
    });

    it('should handle invalid JSON gracefully', async () => {
      mockedFs.access.mockResolvedValueOnce(undefined);
      mockedFs.readFile.mockResolvedValueOnce('invalid json{');
      
      const config = await fileSource.load();
      
      // Intent: Should return empty config for invalid JSON
      expect(config).toEqual({});
    });

    it('should save configuration to primary location', async () => {
      const configData = { storage: { type: 'hybrid' } };
      
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      
      await fileSource.save(configData);
      
      // Intent: Should create directory and write file
      expect(mockedFs.mkdir).toHaveBeenCalled();
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.shadcn-mcp/config.json'),
        JSON.stringify(configData, null, 2),
        'utf-8'
      );
    });

    it('should save to custom path', async () => {
      const configData = { storage: { type: 'hybrid' } };
      const customPath = '/custom/config.json';
      
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);
      
      await fileSource.saveToPath(configData, customPath);
      
      // Intent: Should write to specified path
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        customPath,
        JSON.stringify(configData, null, 2),
        'utf-8'
      );
    });

    it('should load from custom path', async () => {
      const configData = { storage: { type: 'memory-only' } };
      const customPath = '/custom/config.json';
      
      mockedFs.readFile.mockResolvedValueOnce(JSON.stringify(configData));
      
      const config = await fileSource.loadFromPath(customPath);
      
      // Intent: Should load from specified path
      expect(config).toEqual(configData);
      expect(mockedFs.readFile).toHaveBeenCalledWith(customPath, 'utf-8');
    });

    it('should have medium priority', () => {
      // Intent: File source should be between defaults and environment
      expect(fileSource.priority).toBe(2);
    });

    it('should provide primary config path', () => {
      const primaryPath = fileSource.getPrimaryConfigPath();
      
      // Intent: Should provide path for saving config
      expect(typeof primaryPath).toBe('string');
      expect(primaryPath).toContain('.shadcn-mcp/config.json');
    });
  });

  describe('Source Priority Intent', () => {
    it('should have correct priority ordering', () => {
      const defaultSource = new DefaultConfigSource();
      const fileSource = new FileConfigSource();
      const envSource = new EnvironmentConfigSource();
      
      // Intent: Priority should be defaults < file < environment
      expect(defaultSource.priority).toBeLessThan(fileSource.priority);
      expect(fileSource.priority).toBeLessThan(envSource.priority);
    });
  });

  describe('Byte Size Parsing Intent', () => {
    let envSource: EnvironmentConfigSource;
    
    beforeEach(() => {
      envSource = new EnvironmentConfigSource();
    });

    it('should parse various byte size formats', async () => {
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '50MB';
      process.env.SHADCN_MCP_DB_MAX_SIZE = '1GB';
      process.env.SHADCN_MCP_OTHER_SIZE = '512KB';
      
      const config = await envSource.load();
      
      // Intent: Should handle different size units
      expect(config.storage?.memory?.maxSize).toBe(50 * 1024 * 1024);
      expect(config.storage?.pglite?.maxSize).toBe(1024 * 1024 * 1024);
    });

    it('should handle plain numbers as bytes', async () => {
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '1048576'; // 1MB in bytes
      
      const config = await envSource.load();
      
      // Intent: Should treat plain numbers as bytes
      expect(config.storage?.memory?.maxSize).toBe(1048576);
    });

    it('should handle invalid size strings gracefully', async () => {
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = 'invalid';
      
      const config = await envSource.load();
      
      // Intent: Should return 0 for invalid sizes
      expect(config.storage?.memory?.maxSize).toBe(0);
    });
  });
});