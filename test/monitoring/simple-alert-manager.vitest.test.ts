/**
 * Simple Alert Manager Tests
 * Tests alert threshold monitoring and management
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock dependencies
vi.mock('../../build/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

// Import after mocks
import { SimpleAlertManager } from '../../build/monitoring/simple-alert-manager.js';
import type { PerformanceMetrics } from '../../build/monitoring/simple-metrics-collector.js';

// Mock configuration manager
const createMockConfigManager = (alertConfig = {}) => ({
  getAll: vi.fn(() => ({
    monitoring: {
      alerts: {
        cacheHitRate: 50,
        errorRate: 10,
        storageUsage: 80,
        rateLimitRemaining: 100,
        tierResponseTime: 5000,
        ...alertConfig
      }
    }
  }))
});

describe('SimpleAlertManager', () => {
  let alertManager: SimpleAlertManager;
  
  const mockMetrics: PerformanceMetrics = {
    timestamp: Date.now(),
    cacheMetrics: {
      hitRate: 75,
      totalRequests: 1000,
      hits: 750,
      misses: 250,
      avgResponseTime: 100
    },
    storageMetrics: {
      memory: {
        available: true,
        responseTime: 50,
        errorRate: 0,
        usage: 60
      },
      pglite: {
        available: true,
        responseTime: 100,
        errorRate: 0,
        usage: 40
      },
      github: {
        available: true,
        responseTime: 200,
        errorRate: 0,
        usage: 0
      }
    },
    apiMetrics: {
      githubRequests: 100,
      rateLimitRemaining: 4500,
      avgResponseTime: 200,
      errors: 2
    },
    systemMetrics: {
      uptime: 3600000,
      memoryUsage: 100 * 1024 * 1024,
      storageSize: {
        memory: { used: 25 * 1024 * 1024, max: 50 * 1024 * 1024 },
        pglite: { used: 30 * 1024 * 1024, max: 100 * 1024 * 1024 }
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default thresholds when config is not available', () => {
      // Arrange
      const mockConfig = { getAll: vi.fn(() => ({})) };
      
      // Act
      alertManager = new SimpleAlertManager(mockConfig as any);
      
      // Assert
      expect(mockConfig.getAll).toHaveBeenCalled();
      expect(alertManager).toBeDefined();
    });

    it('should initialize with custom thresholds from config', () => {
      // Arrange
      const customThresholds = {
        cacheHitRate: 60,
        errorRate: 5,
        storageUsage: 90,
        rateLimitRemaining: 200,
        tierResponseTime: 3000
      };
      const mockConfig = createMockConfigManager(customThresholds);
      
      // Act
      alertManager = new SimpleAlertManager(mockConfig as any);
      
      // Assert
      expect(mockConfig.getAll).toHaveBeenCalled();
      const thresholds = alertManager.getThresholds();
      expect(thresholds.cacheHitRate).toBe(60);
      expect(thresholds.errorRate).toBe(5);
    });

    it('should handle config errors gracefully', () => {
      // Arrange
      const mockConfig = {
        getAll: vi.fn(() => {
          throw new Error('Config error');
        })
      };
      
      // Act & Assert
      expect(() => {
        alertManager = new SimpleAlertManager(mockConfig as any);
      }).not.toThrow();
    });
  });

  describe('Cache Hit Rate Alerts', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager({ cacheHitRate: 70 });
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should create alert when hit rate is below threshold', () => {
      // Arrange
      const lowHitRateMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 60 }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(lowHitRateMetrics);
      
      // Assert
      const hitRateAlerts = alerts.filter(a => a.type === 'low-cache-hit-rate');
      expect(hitRateAlerts).toHaveLength(1);
      expect(hitRateAlerts[0].severity).toBe('warning');
      expect(hitRateAlerts[0].message).toContain('60.0%');
    });

    it('should not create alert when hit rate is above threshold', () => {
      // Arrange - mockMetrics has 75% hit rate, threshold is 70%
      
      // Act
      const alerts = alertManager.checkMetrics(mockMetrics);
      
      // Assert
      const hitRateAlerts = alerts.filter(a => a.type === 'low-cache-hit-rate');
      expect(hitRateAlerts).toHaveLength(0);
    });
  });

  describe('Rate Limit Alerts', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager({ rateLimitRemaining: 200 });
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should create critical alert when rate limit is very low', () => {
      // Arrange
      const lowRateLimitMetrics = {
        ...mockMetrics,
        apiMetrics: { ...mockMetrics.apiMetrics, rateLimitRemaining: 30 }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(lowRateLimitMetrics);
      
      // Assert
      const rateLimitAlerts = alerts.filter(a => a.type === 'rate-limit-low');
      expect(rateLimitAlerts).toHaveLength(1);
      expect(rateLimitAlerts[0].severity).toBe('critical');
      expect(rateLimitAlerts[0].message).toContain('30 remaining');
    });

    it('should create warning alert when rate limit is moderately low', () => {
      // Arrange
      const lowRateLimitMetrics = {
        ...mockMetrics,
        apiMetrics: { ...mockMetrics.apiMetrics, rateLimitRemaining: 150 }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(lowRateLimitMetrics);
      
      // Assert
      const rateLimitAlerts = alerts.filter(a => a.type === 'rate-limit-low');
      expect(rateLimitAlerts).toHaveLength(1);
      expect(rateLimitAlerts[0].severity).toBe('warning');
    });
  });

  describe('Storage Capacity Alerts', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager({ storageUsage: 70 });
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should create alert for high memory storage usage', () => {
      // Arrange
      const highStorageMetrics = {
        ...mockMetrics,
        systemMetrics: {
          ...mockMetrics.systemMetrics,
          storageSize: {
            memory: { used: 40 * 1024 * 1024, max: 50 * 1024 * 1024 }, // 80%
            pglite: { used: 30 * 1024 * 1024, max: 100 * 1024 * 1024 }
          }
        }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(highStorageMetrics);
      
      // Assert
      const storageAlerts = alerts.filter(a => a.type === 'storage-near-capacity');
      expect(storageAlerts.length).toBeGreaterThan(0);
      const memoryAlert = storageAlerts.find(a => a.message.includes('Memory'));
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert!.severity).toBe('warning');
    });

    it('should create critical alert for very high storage usage', () => {
      // Arrange
      const veryHighStorageMetrics = {
        ...mockMetrics,
        systemMetrics: {
          ...mockMetrics.systemMetrics,
          storageSize: {
            memory: { used: 48 * 1024 * 1024, max: 50 * 1024 * 1024 }, // 96%
            pglite: { used: 30 * 1024 * 1024, max: 100 * 1024 * 1024 }
          }
        }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(veryHighStorageMetrics);
      
      // Assert
      const storageAlerts = alerts.filter(a => a.type === 'storage-near-capacity');
      const memoryAlert = storageAlerts.find(a => a.message.includes('Memory'));
      expect(memoryAlert!.severity).toBe('critical');
    });
  });

  describe('Tier Availability Alerts', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager();
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should create critical alert when memory tier is unavailable', () => {
      // Arrange
      const unavailableMemoryMetrics = {
        ...mockMetrics,
        storageMetrics: {
          ...mockMetrics.storageMetrics,
          memory: { ...mockMetrics.storageMetrics.memory, available: false }
        }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(unavailableMemoryMetrics);
      
      // Assert
      const tierAlerts = alerts.filter(a => a.type === 'tier-unavailable');
      expect(tierAlerts).toHaveLength(1);
      expect(tierAlerts[0].severity).toBe('critical');
      expect(tierAlerts[0].message).toContain("'memory'");
    });

    it('should create warning alert when GitHub tier is unavailable', () => {
      // Arrange
      const unavailableGitHubMetrics = {
        ...mockMetrics,
        storageMetrics: {
          ...mockMetrics.storageMetrics,
          github: { ...mockMetrics.storageMetrics.github, available: false }
        }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(unavailableGitHubMetrics);
      
      // Assert
      const tierAlerts = alerts.filter(a => a.type === 'tier-unavailable');
      expect(tierAlerts).toHaveLength(1);
      expect(tierAlerts[0].severity).toBe('warning');
      expect(tierAlerts[0].message).toContain("'github'");
    });
  });

  describe('Alert Resolution', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager({ cacheHitRate: 70 });
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should resolve alerts when conditions improve', () => {
      // Arrange
      const lowHitRateMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 60 }
      };
      
      // Act - First check creates alert
      let alerts = alertManager.checkMetrics(lowHitRateMetrics);
      expect(alerts.filter(a => a.type === 'low-cache-hit-rate')).toHaveLength(1);
      
      // Act - Second check with improved metrics
      alerts = alertManager.checkMetrics(mockMetrics); // 75% hit rate
      
      // Assert - Alert should be resolved
      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.filter(a => a.type === 'low-cache-hit-rate')).toHaveLength(0);
    });

    it('should not create duplicate alerts for same condition', () => {
      // Arrange
      const lowHitRateMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 60 }
      };
      
      // Act - Check multiple times with same condition
      alertManager.checkMetrics(lowHitRateMetrics);
      alertManager.checkMetrics(lowHitRateMetrics);
      alertManager.checkMetrics(lowHitRateMetrics);
      
      // Assert - Should only have one alert
      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.filter(a => a.type === 'low-cache-hit-rate')).toHaveLength(1);
    });
  });

  describe('Alert Management', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager();
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should manually resolve alerts', () => {
      // Arrange - Create an alert
      const lowHitRateMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 30 }
      };
      
      const alerts = alertManager.checkMetrics(lowHitRateMetrics);
      const alertId = alerts[0].id;
      
      // Act
      const resolved = alertManager.resolveAlert(alertId);
      
      // Assert
      expect(resolved).toBe(true);
      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts).toHaveLength(0);
    });

    it('should not resolve non-existent alerts', () => {
      // Act
      const resolved = alertManager.resolveAlert('non-existent-id');
      
      // Assert
      expect(resolved).toBe(false);
    });

    it('should clear resolved alerts', () => {
      // Arrange - Create and resolve an alert
      const lowHitRateMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 30 }
      };
      
      const alerts = alertManager.checkMetrics(lowHitRateMetrics);
      alertManager.resolveAlert(alerts[0].id);
      
      // Act
      const clearedCount = alertManager.clearResolvedAlerts();
      
      // Assert
      expect(clearedCount).toBe(1);
      expect(alertManager.getAllAlerts()).toHaveLength(0);
    });

    it('should provide alerts summary', () => {
      // Arrange - Create multiple alerts
      const problematicMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 30 },
        apiMetrics: { ...mockMetrics.apiMetrics, rateLimitRemaining: 50 }
      };
      
      alertManager.checkMetrics(problematicMetrics);
      
      // Act
      const summary = alertManager.getAlertsSummary();
      
      // Assert
      expect(summary.active).toBeGreaterThan(0);
      expect(summary.resolved).toBe(0);
      expect(typeof summary.byType).toBe('object');
    });
  });

  describe('Threshold Management', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager();
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should update thresholds', () => {
      // Arrange
      const newThresholds = { cacheHitRate: 80, errorRate: 5 };
      
      // Act
      alertManager.updateThresholds(newThresholds);
      
      // Assert
      const thresholds = alertManager.getThresholds();
      expect(thresholds.cacheHitRate).toBe(80);
      expect(thresholds.errorRate).toBe(5);
      // Other thresholds should remain unchanged
      expect(thresholds.storageUsage).toBe(80); // Default value
    });

    it('should get current thresholds', () => {
      // Act
      const thresholds = alertManager.getThresholds();
      
      // Assert
      expect(typeof thresholds).toBe('object');
      expect(typeof thresholds.cacheHitRate).toBe('number');
      expect(typeof thresholds.errorRate).toBe('number');
      expect(typeof thresholds.storageUsage).toBe('number');
      expect(typeof thresholds.rateLimitRemaining).toBe('number');
      expect(typeof thresholds.tierResponseTime).toBe('number');
    });
  });

  describe('Alert Sorting and Prioritization', () => {
    beforeEach(() => {
      const mockConfig = createMockConfigManager();
      alertManager = new SimpleAlertManager(mockConfig as any);
    });

    it('should sort alerts by severity and timestamp', () => {
      // Arrange - Create alerts with different severities
      const multipleIssuesMetrics = {
        ...mockMetrics,
        cacheMetrics: { ...mockMetrics.cacheMetrics, hitRate: 30 }, // Warning
        apiMetrics: { ...mockMetrics.apiMetrics, rateLimitRemaining: 30 }, // Critical
        storageMetrics: {
          ...mockMetrics.storageMetrics,
          memory: { ...mockMetrics.storageMetrics.memory, available: false } // Critical
        }
      };
      
      // Act
      const alerts = alertManager.checkMetrics(multipleIssuesMetrics);
      
      // Assert - Critical alerts should come first
      expect(alerts.length).toBeGreaterThan(1);
      const criticalAlerts = alerts.filter(a => a.severity === 'critical');
      const warningAlerts = alerts.filter(a => a.severity === 'warning');
      
      // All critical alerts should come before warning alerts
      if (criticalAlerts.length > 0 && warningAlerts.length > 0) {
        const firstWarningIndex = alerts.findIndex(a => a.severity === 'warning');
        const lastCriticalIndex = alerts.map(a => a.severity).lastIndexOf('critical');
        expect(lastCriticalIndex).toBeLessThan(firstWarningIndex);
      }
    });
  });
});