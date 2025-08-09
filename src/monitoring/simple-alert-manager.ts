/**
 * Simple alert manager for performance monitoring
 */

import { PerformanceMetrics } from './simple-metrics-collector.js';
import { ConfigurationManager } from '../config/manager.js';
import { logger } from '../utils/logger.js';

export interface Alert {
  id: string;
  type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  resolved: boolean;
}

export type AlertType = 
  | 'low-cache-hit-rate'
  | 'high-error-rate'
  | 'storage-near-capacity'
  | 'rate-limit-low'
  | 'tier-unavailable';

export interface AlertThresholds {
  cacheHitRate: number;
  errorRate: number;
  storageUsage: number;
  rateLimitRemaining: number;
  tierResponseTime: number;
}

export class SimpleAlertManager {
  private alerts: Map<string, Alert> = new Map();
  private thresholds: AlertThresholds;
  
  constructor(private config: ConfigurationManager) {
    this.thresholds = this.loadThresholds();
  }
  
  private loadThresholds(): AlertThresholds {
    try {
      const config = this.config.getAll();
      
      // Check if config has monitoring thresholds in a custom format
      const monitoring = config.monitoring as any;
      if (monitoring && monitoring.alerts && typeof monitoring.alerts === 'object' && !Array.isArray(monitoring.alerts)) {
        // Use custom threshold configuration if available
        return {
          cacheHitRate: monitoring.alerts.cacheHitRate ?? 50,
          errorRate: monitoring.alerts.errorRate ?? 10,
          storageUsage: monitoring.alerts.storageUsage ?? 80,
          rateLimitRemaining: monitoring.alerts.rateLimitRemaining ?? 100,
          tierResponseTime: monitoring.alerts.tierResponseTime ?? 5000
        };
      }
      
      // Use defaults if no custom configuration
      return {
        cacheHitRate: 50, // Alert if below 50%
        errorRate: 10,    // Alert if above 10%
        storageUsage: 80, // Alert if above 80%
        rateLimitRemaining: 100, // Alert if below 100
        tierResponseTime: 5000 // Alert if above 5 seconds
      };
    } catch (error) {
      logger.warn(`Failed to load alert thresholds from config, using defaults: ${error}`);
      return {
        cacheHitRate: 50,
        errorRate: 10,
        storageUsage: 80,
        rateLimitRemaining: 100,
        tierResponseTime: 5000
      };
    }
  }
  
  checkMetrics(metrics: PerformanceMetrics): Alert[] {
    const newAlerts: Alert[] = [];
    
    // Check cache hit rate
    if (metrics.cacheMetrics.hitRate < this.thresholds.cacheHitRate) {
      newAlerts.push(this.createAlert(
        'low-cache-hit-rate',
        'warning',
        `Cache hit rate is ${metrics.cacheMetrics.hitRate.toFixed(1)}% (threshold: ${this.thresholds.cacheHitRate}%)`
      ));
    }
    
    // Check API rate limit
    if (metrics.apiMetrics.rateLimitRemaining < this.thresholds.rateLimitRemaining) {
      const severity = metrics.apiMetrics.rateLimitRemaining < 50 ? 'critical' : 'warning';
      newAlerts.push(this.createAlert(
        'rate-limit-low',
        severity,
        `GitHub API rate limit low: ${metrics.apiMetrics.rateLimitRemaining} remaining`
      ));
    }
    
    // Check storage capacity
    this.checkStorageCapacity(metrics, newAlerts);
    
    // Check tier availability
    this.checkTierAvailability(metrics, newAlerts);
    
    // Check tier response times
    this.checkTierResponseTimes(metrics, newAlerts);
    
    // Update alerts
    this.updateAlerts(newAlerts);
    
    return this.getActiveAlerts();
  }
  
  private checkStorageCapacity(metrics: PerformanceMetrics, newAlerts: Alert[]): void {
    // Check memory storage capacity
    const memoryUsage = metrics.systemMetrics.storageSize.memory.max > 0 
      ? (metrics.systemMetrics.storageSize.memory.used / metrics.systemMetrics.storageSize.memory.max) * 100 
      : 0;
    
    if (memoryUsage > this.thresholds.storageUsage) {
      const severity = memoryUsage > 95 ? 'critical' : 'warning';
      newAlerts.push(this.createAlert(
        'storage-near-capacity',
        severity,
        `Memory storage at ${memoryUsage.toFixed(1)}% capacity`
      ));
    }
    
    // Check PGLite storage capacity
    const pgliteUsage = metrics.systemMetrics.storageSize.pglite.max > 0 
      ? (metrics.systemMetrics.storageSize.pglite.used / metrics.systemMetrics.storageSize.pglite.max) * 100 
      : 0;
    
    if (pgliteUsage > this.thresholds.storageUsage) {
      const severity = pgliteUsage > 95 ? 'critical' : 'warning';
      newAlerts.push(this.createAlert(
        'storage-near-capacity',
        severity,
        `PGLite storage at ${pgliteUsage.toFixed(1)}% capacity`
      ));
    }
  }
  
  private checkTierAvailability(metrics: PerformanceMetrics, newAlerts: Alert[]): void {
    for (const [tier, tierMetrics] of Object.entries(metrics.storageMetrics)) {
      if (!tierMetrics.available) {
        const severity = tier === 'github' ? 'warning' : 'critical';
        newAlerts.push(this.createAlert(
          'tier-unavailable',
          severity,
          `Storage tier '${tier}' is unavailable`
        ));
      }
    }
  }
  
  private checkTierResponseTimes(metrics: PerformanceMetrics, newAlerts: Alert[]): void {
    for (const [tier, tierMetrics] of Object.entries(metrics.storageMetrics)) {
      if (tierMetrics.available && tierMetrics.responseTime > this.thresholds.tierResponseTime) {
        newAlerts.push(this.createAlert(
          'high-error-rate',
          'warning',
          `Storage tier '${tier}' response time high: ${tierMetrics.responseTime}ms`
        ));
      }
    }
  }
  
  private createAlert(
    type: AlertType,
    severity: Alert['severity'],
    message: string
  ): Alert {
    return {
      id: `${type}-${Date.now()}`,
      type,
      severity,
      message,
      timestamp: Date.now(),
      resolved: false
    };
  }
  
  private updateAlerts(newAlerts: Alert[]): void {
    // Mark existing alerts as resolved if condition no longer exists
    const activeTypes = new Set(newAlerts.map(a => `${a.type}-${this.getAlertKey(a)}`));
    
    for (const alert of this.alerts.values()) {
      const alertKey = `${alert.type}-${this.getAlertKey(alert)}`;
      if (!activeTypes.has(alertKey) && !alert.resolved) {
        alert.resolved = true;
        logger.info(`Alert resolved: ${alert.message}`);
      }
    }
    
    // Add new alerts
    for (const alert of newAlerts) {
      const alertKey = `${alert.type}-${this.getAlertKey(alert)}`;
      const existing = Array.from(this.alerts.values())
        .find(a => `${a.type}-${this.getAlertKey(a)}` === alertKey && !a.resolved);
      
      if (!existing) {
        this.alerts.set(alert.id, alert);
        logger.warn(`New alert: ${alert.message}`);
      }
    }
    
    // Clean up old resolved alerts (keep for 1 hour)
    const cutoff = Date.now() - 3600000;
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.resolved && alert.timestamp < cutoff) {
        this.alerts.delete(id);
      }
    }
  }
  
  private getAlertKey(alert: Alert): string {
    // Create a unique key for alert deduplication based on type and content
    switch (alert.type) {
      case 'tier-unavailable':
        // Extract tier name from message
        const tierMatch = alert.message.match(/'([^']+)'/);
        return tierMatch ? tierMatch[1] : 'unknown';
      case 'storage-near-capacity':
        // Extract storage type from message
        const storageMatch = alert.message.match(/^(\w+)/);
        return storageMatch ? storageMatch[1] : 'unknown';
      default:
        return alert.type;
    }
  }
  
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolved)
      .sort((a, b) => {
        // Sort by severity (critical first), then by timestamp (newest first)
        const severityOrder = { critical: 3, warning: 2, info: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        return severityDiff !== 0 ? severityDiff : b.timestamp - a.timestamp;
      });
  }
  
  getAllAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  getAlertsSummary(): { active: number; resolved: number; byType: Record<AlertType, number> } {
    const alerts = Array.from(this.alerts.values());
    const active = alerts.filter(a => !a.resolved).length;
    const resolved = alerts.filter(a => a.resolved).length;
    
    const byType: Record<AlertType, number> = {
      'low-cache-hit-rate': 0,
      'high-error-rate': 0,
      'storage-near-capacity': 0,
      'rate-limit-low': 0,
      'tier-unavailable': 0
    };
    
    alerts.filter(a => !a.resolved).forEach(alert => {
      byType[alert.type]++;
    });
    
    return { active, resolved, byType };
  }
  
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      logger.info(`Alert manually resolved: ${alert.message}`);
      return true;
    }
    return false;
  }
  
  clearResolvedAlerts(): number {
    const resolvedAlerts = Array.from(this.alerts.entries()).filter(([, alert]) => alert.resolved);
    resolvedAlerts.forEach(([id]) => this.alerts.delete(id));
    return resolvedAlerts.length;
  }
  
  updateThresholds(newThresholds: Partial<AlertThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info(`Alert thresholds updated: ${JSON.stringify(newThresholds)}`);
  }
  
  getThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }
}