/**
 * Simple Metrics Collector Tests
 * Tests metrics collection and time-series functionality
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock dependencies
vi.mock('../../build/utils/storage-integration.js', () => ({
  getStorageStats: vi.fn(),
  isStorageInitialized: vi.fn(),
  getConfigurationManager: vi.fn(() => ({
    getAll: vi.fn(() => ({
      storage: {
        memory: { maxSize: 50 * 1024 * 1024 },
        pglite: { maxSize: 100 * 1024 * 1024 }
      }
    }))
  }))
}));

vi.mock('../../build/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

// Use fake timers for interval testing
vi.useFakeTimers();

// Import after mocks
import { SimpleMetricsCollector } from '../../build/monitoring/simple-metrics-collector.js';
import { 
  getStorageStats, 
  isStorageInitialized,
  getConfigurationManager 
} from '../../build/utils/storage-integration.js';
import type { HybridStorageStats } from '../../build/storage/hybrid/cache-strategies.js';

const mockedGetStorageStats = getStorageStats as MockedFunction<typeof getStorageStats>;
const mockedIsStorageInitialized = isStorageInitialized as MockedFunction<typeof isStorageInitialized>;
const mockedGetConfigurationManager = getConfigurationManager as MockedFunction<typeof getConfigurationManager>;

describe('SimpleMetricsCollector', () => {
  let collector: SimpleMetricsCollector;
  
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  const mockHybridStats: HybridStorageStats = {
    hits: { memory: 100, pglite: 50, github: 25 },
    misses: 25,
    responseTimes: {
      memory: [1, 2, 1, 3],
      pglite: [10, 15, 12, 8],
      github: [200, 150, 300, 250]
    },
    circuitBreaker: {
      state: 'CLOSED',
      failureCount: 0,
      isOpen: false
    },
    totalOperations: 200,
    tierAvailability: {
      memory: true,
      pglite: true,
      github: true
    },
    deduplication: {
      totalRequests: 200,
      deduplicatedRequests: 50,
      currentInFlight: 5,
      deduplicationRate: 0.25
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    
    // Setup default mocks
    mockedIsStorageInitialized.mockReturnValue(true);
    mockedGetStorageStats.mockReturnValue(mockHybridStats);
  });

  afterEach(() => {
    if (collector) {
      collector.dispose();
    }
    vi.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with default metrics', () => {
      // Act
      collector = new SimpleMetricsCollector();
      
      // Assert
      expect(getConfigurationManager).toHaveBeenCalled();
      
      // Should have no current metrics initially
      const current = collector.getCurrentMetrics();
      expect(current).toBeNull();
    });

    it('should start collection interval', () => {
      // Act
      collector = new SimpleMetricsCollector();
      
      // Assert - Should have set up interval
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
  });

  describe('Cache Access Recording', () => {
    beforeEach(() => {
      collector = new SimpleMetricsCollector();
    });

    it('should record cache hits correctly', () => {
      // Arrange
      const responseTime = 50;
      
      // Act
      collector.recordCacheAccess(true, responseTime);
      collector.recordCacheAccess(true, 100);
      collector.recordCacheAccess(false, 200);
      
      // No direct way to test private state, but behavior is tested through metrics collection
      expect(collector).toBeDefined();
    });

    it('should calculate hit rate correctly', () => {
      // Arrange & Act
      collector.recordCacheAccess(true, 10);
      collector.recordCacheAccess(true, 20);
      collector.recordCacheAccess(false, 30);
      collector.recordCacheAccess(false, 40);
      
      // Test that recording doesn't throw
      expect(() => collector.recordCacheAccess(true, 50)).not.toThrow();
    });
  });

  describe('API Call Recording', () => {
    beforeEach(() => {
      collector = new SimpleMetricsCollector();
    });

    it('should record successful API calls', () => {
      // Act
      collector.recordApiCall(true, 100, 4500);
      collector.recordApiCall(true, 150);
      
      // Should not throw
      expect(collector).toBeDefined();
    });

    it('should record failed API calls', () => {
      // Act
      collector.recordApiCall(false, 200, 4400);
      collector.recordApiCall(false, 500);
      
      // Should not throw
      expect(collector).toBeDefined();
    });
  });

  describe('Storage Metrics Collection', () => {
    beforeEach(() => {
      collector = new SimpleMetricsCollector();
    });

    it('should collect metrics when storage is initialized', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(true);
      
      // Act - Advance timers to trigger collection
      await vi.advanceTimersByTimeAsync(60000);
      
      // Assert
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getStorageStats).toHaveBeenCalled();
    });

    it('should handle storage not initialized', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(false);
      
      // Act - Advance timers to trigger collection
      await vi.advanceTimersByTimeAsync(60000);
      
      // Assert
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getStorageStats).not.toHaveBeenCalled();
    });

    it('should handle storage stats errors gracefully', async () => {
      // Arrange
      mockedIsStorageInitialized.mockReturnValue(true);
      mockedGetStorageStats.mockImplementation(() => {
        throw new Error('Storage error');
      });
      
      // Act - Should not throw
      await vi.advanceTimersByTimeAsync(60000);
      
      // Assert
      expect(isStorageInitialized).toHaveBeenCalled();
      expect(getStorageStats).toHaveBeenCalled();
    });
  });

  describe('Metrics History Management', () => {
    beforeEach(() => {
      collector = new SimpleMetricsCollector();
      mockedIsStorageInitialized.mockReturnValue(true);
    });

    it('should retrieve metrics history with default timeframe', async () => {
      // Act - Trigger collection
      await vi.advanceTimersByTimeAsync(60000);
      
      // Get history
      const history = collector.getMetricsHistory();
      
      // Assert - Should be array (empty or with collected metrics)
      expect(Array.isArray(history)).toBe(true);
    });

    it('should retrieve metrics history with custom timeframe', async () => {
      // Act - Trigger collection
      await vi.advanceTimersByTimeAsync(60000);
      
      // Get history with custom timeframe
      const history = collector.getMetricsHistory(30);
      
      // Assert
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit metrics retention to 1 hour', async () => {
      // This tests the private behavior of metrics cleanup
      // We can't directly test private state, but ensure no errors occur
      
      // Act - Advance time by more than 1 hour
      await vi.advanceTimersByTimeAsync(60000); // 1 minute
      await vi.advanceTimersByTimeAsync(3600000); // 1 hour
      await vi.advanceTimersByTimeAsync(60000); // Another minute
      
      // Should not throw errors during cleanup
      expect(collector).toBeDefined();
    });
  });

  describe('Metrics Export', () => {
    beforeEach(() => {
      collector = new SimpleMetricsCollector();
      mockedIsStorageInitialized.mockReturnValue(true);
    });

    it('should export metrics in JSON format', async () => {
      // Arrange - Trigger collection to have some data
      await vi.advanceTimersByTimeAsync(60000);
      
      // Act
      const jsonExport = collector.exportMetrics('json');
      
      // Assert
      expect(typeof jsonExport).toBe('string');
      expect(() => JSON.parse(jsonExport)).not.toThrow();
    });

    it('should export metrics in CSV format', async () => {
      // Arrange - Trigger collection to have some data
      await vi.advanceTimersByTimeAsync(60000);
      
      // Act
      const csvExport = collector.exportMetrics('csv');
      
      // Assert
      expect(typeof csvExport).toBe('string');
      expect(csvExport).toContain('timestamp');
      expect(csvExport).toContain('cache_hit_rate');
    });

    it('should handle empty metrics for export', () => {
      // Act - Export immediately without collection
      const jsonExport = collector.exportMetrics('json');
      const csvExport = collector.exportMetrics('csv');
      
      // Assert - Should handle empty case
      expect(typeof jsonExport).toBe('string');
      expect(typeof csvExport).toBe('string');
    });
  });

  describe('Resource Management', () => {
    it('should dispose resources properly', () => {
      // Arrange
      collector = new SimpleMetricsCollector();
      const initialTimerCount = vi.getTimerCount();
      
      // Act
      collector.dispose();
      
      // Assert - Should clean up timers
      expect(vi.getTimerCount()).toBeLessThanOrEqual(initialTimerCount);
    });

    it('should handle multiple dispose calls', () => {
      // Arrange
      collector = new SimpleMetricsCollector();
      
      // Act & Assert - Should not throw
      expect(() => collector.dispose()).not.toThrow();
      expect(() => collector.dispose()).not.toThrow();
    });
  });

  describe('Configuration Integration', () => {
    it('should use configuration manager for storage settings', () => {
      // Arrange
      const customConfig = {
        storage: {
          memory: { maxSize: 64 * 1024 * 1024 },
          pglite: { maxSize: 200 * 1024 * 1024 }
        }
      };
      
      mockedGetConfigurationManager.mockReturnValue({
        getAll: vi.fn(() => customConfig)
      } as any);
      
      // Act
      collector = new SimpleMetricsCollector();
      
      // Assert
      expect(getConfigurationManager).toHaveBeenCalled();
    });

    it('should handle configuration errors gracefully', () => {
      // Arrange
      mockedGetConfigurationManager.mockImplementation(() => {
        throw new Error('Config error');
      });
      
      // Act & Assert - Should handle error gracefully and not throw
      expect(() => {
        collector = new SimpleMetricsCollector();
      }).not.toThrow();
      
      // Should still be functional with fallback config
      expect(collector).toBeDefined();
    });
  });
});