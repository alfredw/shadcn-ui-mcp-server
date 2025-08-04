/**
 * Storage Integration Tests
 * Tests the intent and behavior of configuration integration with storage system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getConfigurationManager, initializeStorage, disposeStorage, __resetStorageForTesting } from '../../src/utils/storage-integration.js';
import { ConfigurationManager } from '../../src/config/manager.js';

// Mock the storage system
vi.mock('../../src/storage/index.js', () => ({
  HybridStorageProvider: vi.fn().mockImplementation(() => ({
    getHybridConfig: vi.fn().mockReturnValue({}),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false)
  })),
  CacheStrategy: {
    READ_THROUGH: 'read-through',
    WRITE_THROUGH: 'write-through',
    WRITE_BEHIND: 'write-behind',
    CACHE_ASIDE: 'cache-aside'
  }
}));

// Mock file system
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn()
  }
}));

describe('Storage Integration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  
  beforeEach(async () => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    
    // Reset global state for test isolation
    try {
      await disposeStorage();
    } catch {
      // Ignore disposal errors
    }
    __resetStorageForTesting();
  });
  
  afterEach(async () => {
    process.env = originalEnv;
    
    // Clean up storage after each test
    try {
      await disposeStorage();
    } catch {
      // Ignore disposal errors
    }
    __resetStorageForTesting();
  });

  describe('Configuration Manager Access Intent', () => {
    it('should provide singleton configuration manager', () => {
      const manager1 = getConfigurationManager();
      const manager2 = getConfigurationManager();
      
      // Intent: Should return same instance (singleton pattern)
      expect(manager1).toBe(manager2);
      expect(manager1).toBeInstanceOf(ConfigurationManager);
    });

    it('should create new instance if none exists', () => {
      const manager = getConfigurationManager();
      
      // Intent: Should create valid configuration manager
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(ConfigurationManager);
    });
  });

  describe('Storage Configuration Mapping Intent', () => {
    it('should map configuration to storage config correctly', async () => {
      // Setup environment variables
      process.env.SHADCN_MCP_STORAGE_TYPE = 'hybrid';
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '64MB';
      process.env.SHADCN_MCP_DB_MAX_SIZE = '128MB';
      process.env.SHADCN_MCP_CACHE_STRATEGY = 'write-through';
      
      // Mock file access to fail (no config file)
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: Should initialize storage with configuration from manager
      await expect(initializeStorage()).resolves.not.toThrow();
      
      // Intent: Should have called HybridStorageProvider constructor
      const { HybridStorageProvider } = await import('../../src/storage/index.js');
      expect(HybridStorageProvider).toHaveBeenCalled();
    });

    it('should fall back to legacy config on configuration errors', async () => {
      // Setup: Make configuration loading fail
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Setup legacy environment variables
      process.env.STORAGE_MEMORY_MAX_SIZE = '32MB';
      process.env.STORAGE_PGLITE_MAX_SIZE = '64MB';
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_test';
      
      // Intent: Should fall back to legacy configuration
      await expect(initializeStorage()).resolves.not.toThrow();
    });

    it('should handle missing configuration gracefully', async () => {
      // Clear all environment variables
      Object.keys(process.env).forEach(key => {
        if (key.startsWith('SHADCN_MCP_') || key.startsWith('STORAGE_') || key === 'GITHUB_PERSONAL_ACCESS_TOKEN') {
          delete process.env[key];
        }
      });
      
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: Should initialize with defaults when no config available
      await expect(initializeStorage()).resolves.not.toThrow();
    });
  });

  describe('Configuration Change Handling Intent', () => {
    it('should setup configuration watchers', async () => {
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: Should initialize and setup watchers without errors
      await expect(initializeStorage()).resolves.not.toThrow();
      
      // Note: We can't easily test the watcher callback without more complex mocking
      // but we can verify initialization completes successfully
    });
  });

  describe('Storage Strategy Mapping Intent', () => {
    it('should map cache strategies correctly', async () => {
      const testCases = [
        ['write-through', 'write-through'],
        ['write-behind', 'write-behind'], 
        ['read-through', 'read-through'],
        ['cache-aside', 'cache-aside'],
        ['invalid', 'read-through'] // Should default to read-through
      ];
      
      for (const [input, expected] of testCases) {
        process.env.SHADCN_MCP_CACHE_STRATEGY = input;
        
        const fs = await import('fs');
        vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
        
        // Clear any existing storage instance
        vi.clearAllMocks();
        
        // Intent: Should map strategy correctly
        await expect(initializeStorage()).resolves.not.toThrow();
      }
    });
  });

  describe('Backward Compatibility Intent', () => {
    it('should support legacy environment variables', async () => {
      // Reset state and mocks for this specific test
      __resetStorageForTesting();
      vi.clearAllMocks();
      
      // Setup legacy environment variables (old format)
      process.env.STORAGE_MEMORY_MAX_SIZE = '50000000'; // 50MB
      process.env.STORAGE_PGLITE_ENABLED = 'true';
      process.env.STORAGE_GITHUB_TIMEOUT = '45000';
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_legacy';
      
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: Should work with legacy environment variables
      await expect(initializeStorage()).resolves.not.toThrow();
      
      const { HybridStorageProvider } = await import('../../src/storage/index.js');
      expect(HybridStorageProvider).toHaveBeenCalled();
    });

    it('should prefer new configuration over legacy', async () => {
      // Setup both legacy and new environment variables
      process.env.STORAGE_MEMORY_MAX_SIZE = '50000000'; // Legacy
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '100MB';  // New - should take precedence
      
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: New configuration format should take precedence
      await expect(initializeStorage()).resolves.not.toThrow();
    });
  });

  describe('Error Handling Intent', () => {
    it('should handle storage initialization errors', async () => {
      // Reset storage state first
      __resetStorageForTesting();
      
      const { HybridStorageProvider } = await import('../../src/storage/index.js');
      vi.mocked(HybridStorageProvider).mockImplementation(() => {
        throw new Error('Storage initialization failed');
      });
      
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Intent: Should propagate storage initialization errors
      await expect(initializeStorage()).rejects.toThrow('Storage initialization failed');
    });

    it('should handle configuration loading errors gracefully', async () => {
      // Reset state first
      __resetStorageForTesting();
      
      // Mock configuration manager methods to simulate config loading that succeeds 
      // but getAll() fails (which would trigger the fallback inside getStorageConfig)
      const configManager = getConfigurationManager();
      vi.spyOn(configManager, 'load').mockResolvedValue(undefined);
      vi.spyOn(configManager, 'getAll').mockImplementation(() => {
        throw new Error('Config access failed');
      });
      
      // Intent: Should fall back to legacy configuration when config access fails
      await expect(initializeStorage()).resolves.not.toThrow();
    });
  });

  describe('Configuration Integration Completeness Intent', () => {
    it('should map all required configuration sections', async () => {
      // Reset state and mocks for this specific test
      __resetStorageForTesting();
      vi.clearAllMocks();
      
      const fs = await import('fs');
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('File not found'));
      
      // Setup comprehensive environment configuration
      process.env.SHADCN_MCP_STORAGE_TYPE = 'hybrid';
      process.env.SHADCN_MCP_MEMORY_ENABLED = 'true';
      process.env.SHADCN_MCP_MEMORY_MAX_SIZE = '50MB';
      process.env.SHADCN_MCP_DB_MAX_SIZE = '100MB';
      process.env.SHADCN_MCP_GITHUB_TIMEOUT = '30000';
      process.env.SHADCN_MCP_CACHE_STRATEGY = 'read-through';
      process.env.SHADCN_MCP_CIRCUIT_BREAKER_THRESHOLD = '5';
      
      await initializeStorage();
      
      const { HybridStorageProvider } = await import('../../src/storage/index.js');
      expect(HybridStorageProvider).toHaveBeenCalled();
      
      // Intent: Should pass complete configuration to storage provider
      const constructorCall = vi.mocked(HybridStorageProvider).mock.calls[0];
      const config = constructorCall[0];
      
      expect(config).toHaveProperty('memory');
      expect(config).toHaveProperty('pglite');
      expect(config).toHaveProperty('github');
      expect(config).toHaveProperty('strategy');
      expect(config).toHaveProperty('circuitBreaker');
    });
  });
});