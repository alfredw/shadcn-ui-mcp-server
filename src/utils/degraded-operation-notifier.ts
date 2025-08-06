/**
 * Degraded Operation Notifier
 * 
 * Provides user feedback system for degraded operation states,
 * including notifications and active issue tracking.
 */

import { logger } from './logger.js';

/**
 * Degraded operation notification types
 */
export type DegradedNotificationType = 
  | 'storage-failure' 
  | 'api-degraded' 
  | 'serving-stale' 
  | 'partial-data'
  | 'circuit-breaker-open'
  | 'high-error-rate';

/**
 * Notification severity levels
 */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Degraded operation notification
 */
export interface DegradedNotification {
  type: DegradedNotificationType;
  tier: string;
  message: string;
  severity: NotificationSeverity;
  timestamp: number;
  context?: any;
  key?: string;
}

/**
 * Notification subscriber callback
 */
export type NotificationSubscriber = (notification: DegradedNotification) => void;

/**
 * Active issue summary
 */
export interface ActiveIssue {
  type: DegradedNotificationType;
  tier: string;
  message: string;
  severity: NotificationSeverity;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
}

/**
 * Degraded Operation Notifier
 * 
 * Manages notifications for degraded system states and provides
 * user feedback through subscriptions and active issue tracking.
 */
export class DegradedOperationNotifier {
  private notifications: DegradedNotification[] = [];
  private subscribers: NotificationSubscriber[] = [];
  private readonly maxNotifications = 1000;
  private readonly notificationRetentionMs = 3600000; // 1 hour
  
  /**
   * Send a degraded operation notification
   */
  notify(notification: DegradedNotification): void {
    // Add timestamp if not provided
    if (!notification.timestamp) {
      notification.timestamp = Date.now();
    }
    
    // Add to notifications history
    this.notifications.push(notification);
    
    // Clean up old notifications
    this.cleanupNotifications();
    
    // Log the notification
    this.logNotification(notification);
    
    // Notify all subscribers
    this.notifySubscribers(notification);
  }
  
  /**
   * Convenience method to notify storage failure
   */
  notifyStorageFailure(
    tier: string, 
    key: string, 
    error: string, 
    severity: NotificationSeverity = 'error'
  ): void {
    this.notify({
      type: 'storage-failure',
      tier,
      key,
      message: `Storage operation failed: ${error}`,
      severity,
      timestamp: Date.now(),
      context: { error, key }
    });
  }
  
  /**
   * Convenience method to notify API degradation
   */
  notifyApiDegraded(
    tier: string, 
    message: string, 
    severity: NotificationSeverity = 'warning'
  ): void {
    this.notify({
      type: 'api-degraded',
      tier,
      message,
      severity,
      timestamp: Date.now()
    });
  }
  
  /**
   * Convenience method to notify serving stale data
   */
  notifyServingStale(
    tier: string, 
    key: string, 
    age: number
  ): void {
    this.notify({
      type: 'serving-stale',
      tier,
      key,
      message: `Serving stale data (${Math.round(age / 1000)}s old)`,
      severity: 'info',
      timestamp: Date.now(),
      context: { key, age }
    });
  }
  
  /**
   * Convenience method to notify partial data
   */
  notifyPartialData(
    tier: string, 
    key: string, 
    missingFields: string[]
  ): void {
    this.notify({
      type: 'partial-data',
      tier,
      key,
      message: `Serving partial data, missing: ${missingFields.join(', ')}`,
      severity: 'warning',
      timestamp: Date.now(),
      context: { key, missingFields }
    });
  }
  
  /**
   * Convenience method to notify circuit breaker open
   */
  notifyCircuitBreakerOpen(tier: string): void {
    this.notify({
      type: 'circuit-breaker-open',
      tier,
      message: `Circuit breaker open for ${tier}`,
      severity: 'error',
      timestamp: Date.now()
    });
  }
  
  /**
   * Convenience method to notify high error rate
   */
  notifyHighErrorRate(tier: string, rate: number): void {
    this.notify({
      type: 'high-error-rate',
      tier,
      message: `High error rate detected: ${(rate * 100).toFixed(1)}%`,
      severity: rate > 0.5 ? 'critical' : 'error',
      timestamp: Date.now(),
      context: { rate }
    });
  }
  
  /**
   * Subscribe to notifications
   */
  subscribe(callback: NotificationSubscriber): () => void {
    this.subscribers.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }
  
  /**
   * Get active issues (deduplicated recent notifications)
   */
  getActiveIssues(minutesBack: number = 5): ActiveIssue[] {
    const cutoff = Date.now() - (minutesBack * 60 * 1000);
    const recentNotifications = this.notifications.filter(
      n => n.timestamp > cutoff
    );
    
    // Group by type and tier
    const issueMap = new Map<string, ActiveIssue>();
    
    for (const notification of recentNotifications) {
      const key = `${notification.type}:${notification.tier}`;
      const existing = issueMap.get(key);
      
      if (existing) {
        existing.lastSeen = Math.max(existing.lastSeen, notification.timestamp);
        existing.occurrences++;
        // Update to highest severity
        if (this.getSeverityWeight(notification.severity) > this.getSeverityWeight(existing.severity)) {
          existing.severity = notification.severity;
          existing.message = notification.message;
        }
      } else {
        issueMap.set(key, {
          type: notification.type,
          tier: notification.tier,
          message: notification.message,
          severity: notification.severity,
          firstSeen: notification.timestamp,
          lastSeen: notification.timestamp,
          occurrences: 1
        });
      }
    }
    
    // Sort by severity and recency
    return Array.from(issueMap.values()).sort((a, b) => {
      const severityDiff = this.getSeverityWeight(b.severity) - this.getSeverityWeight(a.severity);
      if (severityDiff !== 0) return severityDiff;
      return b.lastSeen - a.lastSeen;
    });
  }
  
  /**
   * Get notification history
   */
  getNotificationHistory(minutesBack: number = 60): DegradedNotification[] {
    const cutoff = Date.now() - (minutesBack * 60 * 1000);
    return this.notifications
      .filter(n => n.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * Get notifications for a specific tier
   */
  getTierNotifications(tier: string, minutesBack: number = 60): DegradedNotification[] {
    const cutoff = Date.now() - (minutesBack * 60 * 1000);
    return this.notifications
      .filter(n => n.tier === tier && n.timestamp > cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * Check if system is currently degraded
   */
  isSystemDegraded(minutesBack: number = 5): boolean {
    const activeIssues = this.getActiveIssues(minutesBack);
    return activeIssues.some(issue => 
      issue.severity === 'error' || issue.severity === 'critical'
    );
  }
  
  /**
   * Get degradation summary
   */
  getDegradationSummary(minutesBack: number = 5): {
    isDegraded: boolean;
    criticalIssues: number;
    errorIssues: number;
    warningIssues: number;
    totalIssues: number;
    affectedTiers: string[];
  } {
    const activeIssues = this.getActiveIssues(minutesBack);
    
    const criticalIssues = activeIssues.filter(i => i.severity === 'critical').length;
    const errorIssues = activeIssues.filter(i => i.severity === 'error').length;
    const warningIssues = activeIssues.filter(i => i.severity === 'warning').length;
    const affectedTiers = [...new Set(activeIssues.map(i => i.tier))];
    
    return {
      isDegraded: criticalIssues > 0 || errorIssues > 0,
      criticalIssues,
      errorIssues,
      warningIssues,
      totalIssues: activeIssues.length,
      affectedTiers
    };
  }
  
  /**
   * Clear notifications history
   */
  clearHistory(): void {
    this.notifications = [];
  }
  
  /**
   * Clear notifications for a specific tier
   */
  clearTierHistory(tier: string): void {
    this.notifications = this.notifications.filter(n => n.tier !== tier);
  }
  
  /**
   * Get notification count by type
   */
  getNotificationCounts(minutesBack: number = 60): Record<DegradedNotificationType, number> {
    const cutoff = Date.now() - (minutesBack * 60 * 1000);
    const recentNotifications = this.notifications.filter(n => n.timestamp > cutoff);
    
    const counts: Record<DegradedNotificationType, number> = {
      'storage-failure': 0,
      'api-degraded': 0,
      'serving-stale': 0,
      'partial-data': 0,
      'circuit-breaker-open': 0,
      'high-error-rate': 0
    };
    
    for (const notification of recentNotifications) {
      counts[notification.type]++;
    }
    
    return counts;
  }
  
  /**
   * Log notification to console
   */
  private logNotification(notification: DegradedNotification): void {
    const message = `[${notification.tier}] ${notification.message}`;
    
    switch (notification.severity) {
      case 'critical':
      case 'error':
        logger.error(message);
        break;
      case 'warning':
        logger.warn(message);
        break;
      case 'info':
        logger.info(message);
        break;
    }
  }
  
  /**
   * Notify all subscribers
   */
  private notifySubscribers(notification: DegradedNotification): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(notification);
      } catch (error) {
        logger.error('Notification subscriber error', error);
      }
    }
  }
  
  /**
   * Clean up old notifications
   */
  private cleanupNotifications(): void {
    const cutoff = Date.now() - this.notificationRetentionMs;
    this.notifications = this.notifications.filter(n => n.timestamp > cutoff);
    
    // Also enforce max count
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(-this.maxNotifications);
    }
  }
  
  /**
   * Get numeric weight for severity comparison
   */
  private getSeverityWeight(severity: NotificationSeverity): number {
    switch (severity) {
      case 'critical': return 4;
      case 'error': return 3;
      case 'warning': return 2;
      case 'info': return 1;
      default: return 0;
    }
  }
}