/**
 * Health checker for comprehensive system health monitoring
 */

import { SimpleMetricsCollector, PerformanceMetrics } from './simple-metrics-collector.js';
import { getStorage, isStorageInitialized, getStorageStats } from '../utils/storage-integration.js';
import { logger } from '../utils/logger.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  metrics: PerformanceMetrics | null;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
}

export interface HealthCheck {
  name: string;
  healthy: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  responseTime?: number;
  details?: Record<string, any>;
}

export class HealthChecker {
  constructor(private collector: SimpleMetricsCollector) {}
  
  async getHealthStatus(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      const checks = await Promise.all([
        this.checkStorageSystem(),
        this.checkCachePerformance(),
        this.checkGitHubApi(),
        this.checkSystemResources()
      ]);
      
      const summary = this.calculateSummary(checks);
      const overall = this.determineOverallStatus(checks);
      
      return {
        status: overall,
        timestamp: new Date().toISOString(),
        checks,
        metrics: this.collector.getCurrentMetrics(),
        summary
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      
      const errorCheck: HealthCheck = {
        name: 'health-system',
        healthy: false,
        message: `Health check system failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'critical',
        responseTime: Date.now() - startTime
      };
      
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: [errorCheck],
        metrics: null,
        summary: { total: 1, healthy: 0, degraded: 0, unhealthy: 1 }
      };
    }
  }
  
  private async checkStorageSystem(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      if (!isStorageInitialized()) {
        return {
          name: 'storage-system',
          healthy: false,
          message: 'Storage system not initialized',
          severity: 'critical',
          responseTime: Date.now() - startTime
        };
      }
      
      const storage = getStorage();
      const stats = getStorageStats();
      
      if (!stats) {
        return {
          name: 'storage-system',
          healthy: false,
          message: 'Unable to retrieve storage statistics',
          severity: 'critical',
          responseTime: Date.now() - startTime
        };
      }
      
      // Check tier availability
      const unavailableTiers = [];
      if (!stats.tierAvailability.memory) unavailableTiers.push('memory');
      if (!stats.tierAvailability.pglite) unavailableTiers.push('pglite');
      if (!stats.tierAvailability.github) unavailableTiers.push('github');
      
      const healthy = unavailableTiers.length === 0;
      const severity = unavailableTiers.includes('memory') || unavailableTiers.includes('pglite') 
        ? 'critical' 
        : unavailableTiers.includes('github') ? 'warning' : 'info';
      
      const message = healthy 
        ? 'All storage tiers operational'
        : `Storage tiers unavailable: ${unavailableTiers.join(', ')}`;
      
      return {
        name: 'storage-system',
        healthy,
        message,
        severity: healthy ? 'info' : severity,
        responseTime: Date.now() - startTime,
        details: {
          tierAvailability: stats.tierAvailability,
          circuitBreakerOpen: stats.circuitBreaker.isOpen,
          totalOperations: stats.totalOperations
        }
      };
    } catch (error) {
      return {
        name: 'storage-system',
        healthy: false,
        message: `Storage system check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'critical',
        responseTime: Date.now() - startTime
      };
    }
  }
  
  private async checkCachePerformance(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const metrics = this.collector.getCurrentMetrics();
      
      if (!metrics) {
        return {
          name: 'cache-performance',
          healthy: true,
          message: 'No performance metrics available yet',
          severity: 'info',
          responseTime: Date.now() - startTime
        };
      }
      
      const hitRate = metrics.cacheMetrics.hitRate;
      const avgResponseTime = metrics.cacheMetrics.avgResponseTime;
      
      // Define thresholds
      const hitRateThreshold = 30; // Minimum acceptable hit rate
      const responseTimeThreshold = 1000; // Maximum acceptable response time
      
      const hitRateOk = hitRate >= hitRateThreshold;
      const responseTimeOk = avgResponseTime <= responseTimeThreshold;
      const healthy = hitRateOk && responseTimeOk;
      
      let message = `Cache hit rate: ${hitRate.toFixed(1)}%, Avg response: ${avgResponseTime.toFixed(0)}ms`;
      let severity: HealthCheck['severity'] = 'info';
      
      if (!hitRateOk && !responseTimeOk) {
        message = `Poor cache performance: ${hitRate.toFixed(1)}% hit rate, ${avgResponseTime.toFixed(0)}ms response time`;
        severity = 'warning';
      } else if (!hitRateOk) {
        message = `Low cache hit rate: ${hitRate.toFixed(1)}% (threshold: ${hitRateThreshold}%)`;
        severity = 'warning';
      } else if (!responseTimeOk) {
        message = `High cache response time: ${avgResponseTime.toFixed(0)}ms (threshold: ${responseTimeThreshold}ms)`;
        severity = 'warning';
      }
      
      return {
        name: 'cache-performance',
        healthy,
        message,
        severity: healthy ? 'info' : severity,
        responseTime: Date.now() - startTime,
        details: {
          hitRate,
          avgResponseTime,
          totalRequests: metrics.cacheMetrics.totalRequests,
          hits: metrics.cacheMetrics.hits,
          misses: metrics.cacheMetrics.misses
        }
      };
    } catch (error) {
      return {
        name: 'cache-performance',
        healthy: false,
        message: `Cache performance check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'warning',
        responseTime: Date.now() - startTime
      };
    }
  }
  
  private async checkGitHubApi(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const metrics = this.collector.getCurrentMetrics();
      
      if (!metrics) {
        return {
          name: 'github-api',
          healthy: true,
          message: 'No GitHub API metrics available yet',
          severity: 'info',
          responseTime: Date.now() - startTime
        };
      }
      
      const rateLimitRemaining = metrics.apiMetrics.rateLimitRemaining;
      const errors = metrics.apiMetrics.errors;
      const avgResponseTime = metrics.apiMetrics.avgResponseTime;
      
      // Define thresholds
      const criticalRateLimit = 50;
      const warningRateLimit = 200;
      const maxErrors = 10;
      const maxResponseTime = 5000;
      
      const rateLimitOk = rateLimitRemaining >= criticalRateLimit;
      const errorsOk = errors <= maxErrors;
      const responseTimeOk = avgResponseTime <= maxResponseTime;
      
      let severity: HealthCheck['severity'] = 'info';
      let message = `GitHub API operational: ${rateLimitRemaining}/5000 rate limit, ${errors} errors`;
      
      if (rateLimitRemaining <= criticalRateLimit) {
        severity = 'critical';
        message = `GitHub API rate limit critical: ${rateLimitRemaining}/5000 remaining`;
      } else if (rateLimitRemaining <= warningRateLimit || errors > maxErrors || avgResponseTime > maxResponseTime) {
        severity = 'warning';
        const issues = [];
        if (rateLimitRemaining <= warningRateLimit) issues.push(`low rate limit (${rateLimitRemaining})`);
        if (errors > maxErrors) issues.push(`high error count (${errors})`);
        if (avgResponseTime > maxResponseTime) issues.push(`slow response (${avgResponseTime.toFixed(0)}ms)`);
        message = `GitHub API issues: ${issues.join(', ')}`;
      }
      
      const healthy = rateLimitOk && errorsOk && responseTimeOk;
      
      return {
        name: 'github-api',
        healthy,
        message,
        severity: healthy ? 'info' : severity,
        responseTime: Date.now() - startTime,
        details: {
          rateLimitRemaining,
          errors,
          avgResponseTime,
          totalRequests: metrics.apiMetrics.githubRequests
        }
      };
    } catch (error) {
      return {
        name: 'github-api',
        healthy: false,
        message: `GitHub API check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'warning',
        responseTime: Date.now() - startTime
      };
    }
  }
  
  private async checkSystemResources(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const metrics = this.collector.getCurrentMetrics();
      const memoryUsage = process.memoryUsage();
      
      // Memory usage thresholds (in MB)
      const warningMemoryMB = 200;
      const criticalMemoryMB = 500;
      
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;
      
      const memoryOk = heapUsedMB < criticalMemoryMB;
      let severity: HealthCheck['severity'] = 'info';
      let message = `Memory usage: ${heapUsedMB.toFixed(1)}MB heap`;
      
      if (heapUsedMB >= criticalMemoryMB) {
        severity = 'critical';
        message = `High memory usage: ${heapUsedMB.toFixed(1)}MB heap (critical threshold: ${criticalMemoryMB}MB)`;
      } else if (heapUsedMB >= warningMemoryMB) {
        severity = 'warning';
        message = `Elevated memory usage: ${heapUsedMB.toFixed(1)}MB heap (warning threshold: ${warningMemoryMB}MB)`;
      }
      
      const details: Record<string, any> = {
        heapUsed: Math.round(heapUsedMB),
        heapTotal: Math.round(heapTotalMB),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };
      
      if (metrics) {
        details.uptime = metrics.systemMetrics.uptime;
        details.storageSize = metrics.systemMetrics.storageSize;
      }
      
      return {
        name: 'system-resources',
        healthy: memoryOk,
        message,
        severity: memoryOk ? 'info' : severity,
        responseTime: Date.now() - startTime,
        details
      };
    } catch (error) {
      return {
        name: 'system-resources',
        healthy: false,
        message: `System resources check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'warning',
        responseTime: Date.now() - startTime
      };
    }
  }
  
  private calculateSummary(checks: HealthCheck[]) {
    const total = checks.length;
    let healthy = 0;
    let degraded = 0;
    let unhealthy = 0;
    
    for (const check of checks) {
      if (check.healthy) {
        healthy++;
      } else if (check.severity === 'critical') {
        unhealthy++;
      } else {
        degraded++;
      }
    }
    
    return { total, healthy, degraded, unhealthy };
  }
  
  private determineOverallStatus(checks: HealthCheck[]): 'healthy' | 'degraded' | 'unhealthy' {
    const hasCritical = checks.some(c => !c.healthy && c.severity === 'critical');
    const hasWarning = checks.some(c => !c.healthy && c.severity === 'warning');
    
    if (hasCritical) return 'unhealthy';
    if (hasWarning) return 'degraded';
    return 'healthy';
  }
}