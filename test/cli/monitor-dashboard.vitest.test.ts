/**
 * Monitor Dashboard Command Test
 * Tests behavior-based CLI operations for monitoring dashboard
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { writeFile } from 'fs/promises';

// Mock the storage integration module BEFORE importing anything that uses it
vi.mock('../../build/utils/storage-integration.js', () => ({
  getStorage: vi.fn(),
  isStorageInitialized: vi.fn(),
  getStorageStats: vi.fn(),
  getCircuitBreakerStatus: vi.fn(),
  getConfigurationManager: vi.fn(() => ({
    getAll: vi.fn(() => ({
      storage: {
        memory: { maxSize: 50 * 1024 * 1024 },
        pglite: { maxSize: 100 * 1024 * 1024 }
      },
      monitoring: {
        alerts: {
          cacheHitRate: 50,
          errorRate: 10,
          storageUsage: 80,
          rateLimitRemaining: 100,
          tierResponseTime: 5000
        }
      }
    }))
  })),
  initializeStorage: vi.fn(),
  disposeStorage: vi.fn()
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn()
}));

// Mock ora spinner to prevent console noise
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
  }))
}));

// Mock process methods
const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

// Mock console methods - but we don't test their output (behavior-based testing)
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  clear: vi.spyOn(console, 'clear').mockImplementation(() => {})
};

// Mock setTimeout and setInterval for testing
vi.useFakeTimers();

// NOW import the modules after mocks are set up
import { handleMonitoringDashboard } from '../../build/cli/commands/monitor-dashboard.js';
import { 
  isStorageInitialized,
  getConfigurationManager
} from '../../build/utils/storage-integration.js';

// Cast mocked functions for type safety
const mockedIsStorageInitialized = isStorageInitialized as MockedFunction<typeof isStorageInitialized>;
const mockedGetConfigurationManager = getConfigurationManager as MockedFunction<typeof getConfigurationManager>;
const mockedWriteFile = writeFile as MockedFunction<typeof writeFile>;

describe('Monitor Dashboard Command', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    vi.clearAllTimers();
    
    // Reset console spies
    consoleSpy.log.mockClear();
    consoleSpy.error.mockClear();
    consoleSpy.warn.mockClear();
    consoleSpy.clear.mockClear();
    
    // Set NODE_ENV for testing
    process.env.NODE_ENV = 'test';
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Storage Not Initialized', () => {
    it('should warn when storage is not initialized', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(false);
      
      // Act
      await handleMonitoringDashboard();
      
      // Assert - Test behavior, not console output
      expect(isStorageInitialized).toHaveBeenCalled();
      
      // Should not proceed with dashboard initialization
      expect(getConfigurationManager).not.toHaveBeenCalled();
    });
  });

  describe('Metrics Export', () => {
    beforeEach(() => {
      mockedIsStorageInitialized.mockReturnValue(true);
    });

    it('should export metrics to JSON file', async () => {
      // Arrange
      const filename = 'test-metrics.json';
      mockedWriteFile.mockResolvedValue(undefined);
      
      // Act
      await handleMonitoringDashboard({ 
        export: 'json', 
        filename 
      });
      
      // Assert - Test actual behavior
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getConfigurationManager).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        filename,
        expect.stringMatching(/^\[.*\]$/) // JSON array format
      );
    });

    it('should export metrics to CSV file with default filename', async () => {
      // Arrange
      mockedWriteFile.mockResolvedValue(undefined);
      
      // Act
      await handleMonitoringDashboard({ export: 'csv' });
      
      // Assert - Test actual behavior
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getConfigurationManager).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/^metrics-.*\.csv$/),
        expect.stringContaining('timestamp,cache_hit_rate') // CSV header
      );
    });

    it('should handle export failure gracefully', async () => {
      // Arrange
      const exportError = new Error('Export failed');
      mockedWriteFile.mockRejectedValue(exportError);
      
      // Act & Assert
      await expect(async () => {
        await handleMonitoringDashboard({ export: 'json' });
      }).rejects.toThrow('process.exit called'); // Should exit on failure
      
      // Verify behavior
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Dashboard Display', () => {
    beforeEach(() => {
      mockedIsStorageInitialized.mockReturnValue(true);
    });

    it('should initialize monitoring components for dashboard display', async () => {
      // Act
      await handleMonitoringDashboard();
      
      // Assert - Test that required services are called
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getConfigurationManager).toHaveBeenCalled();
      
      // Should clear console for dashboard display
      expect(consoleSpy.clear).toHaveBeenCalled();
    });

    it('should handle watch mode initialization', async () => {
      // Arrange
      const interval = 10;
      
      // Act
      const dashboardPromise = handleMonitoringDashboard({ 
        watch: true, 
        interval 
      });
      
      // Let the initial display run
      await vi.runOnlyPendingTimersAsync();
      
      // Assert - Test behavior
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getConfigurationManager).toHaveBeenCalled();
      
      // Should have setup interval for watch mode
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      
      // Cleanup - simulate SIGINT to stop watch mode
      process.emit('SIGINT');
    });
  });

  describe('Configuration Integration', () => {
    it('should use configuration manager for alert thresholds', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(true);
      const mockConfig = {
        storage: {
          memory: { maxSize: 64 * 1024 * 1024 },
          pglite: { maxSize: 200 * 1024 * 1024 }
        },
        monitoring: {
          alerts: {
            cacheHitRate: 60,
            errorRate: 5,
            storageUsage: 85,
            rateLimitRemaining: 50,
            tierResponseTime: 3000
          }
        }
      };
      
      mockedGetConfigurationManager.mockReturnValue({
        getAll: vi.fn(() => mockConfig)
      } as any);
      
      // Act
      await handleMonitoringDashboard();
      
      // Assert - Test that configuration is accessed
      expect(getConfigurationManager).toHaveBeenCalled();
      expect(mockedGetConfigurationManager().getAll).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle configuration manager errors gracefully', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(true);
      mockedGetConfigurationManager.mockImplementation(() => {
        throw new Error('Config error');
      });
      
      // Act
      await handleMonitoringDashboard();
      
      // Assert - Should still attempt to initialize despite config error
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getConfigurationManager).toHaveBeenCalled();
      
      // Should still attempt to display dashboard
      expect(consoleSpy.clear).toHaveBeenCalled();
    });
  });

  describe('Signal Handling', () => {
    beforeEach(() => {
      mockedIsStorageInitialized.mockReturnValue(true);
    });

    it('should setup signal handlers for watch mode cleanup', async () => {
      // Arrange
      const originalListenerCount = process.listenerCount('SIGINT');
      
      // Act
      handleMonitoringDashboard({ watch: true });
      await vi.runOnlyPendingTimersAsync();
      
      // Assert - Should have added SIGINT listener for cleanup
      expect(process.listenerCount('SIGINT')).toBeGreaterThan(originalListenerCount);
      
      // Cleanup
      process.emit('SIGINT');
    });
  });
});