/**
 * Recovery Monitor
 * 
 * Tracks recovery metrics and provides monitoring capabilities for the
 * error recovery system.
 */

/**
 * Recovery metrics interface
 */
export interface RecoveryMetrics {
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  averageRecoveryTime: number;
  tierFailures: Map<string, number>;
}

/**
 * Recovery attempt details
 */
export interface RecoveryAttempt {
  tier: string;
  key: string;
  success: boolean;
  duration: number;
  timestamp: number;
  error?: string;
}

/**
 * Recovery Monitor
 * 
 * Tracks recovery operations and provides metrics for monitoring
 * and alerting purposes.
 */
export class RecoveryMonitor {
  private metrics: RecoveryMetrics = {
    totalRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    averageRecoveryTime: 0,
    tierFailures: new Map()
  };
  
  private recentAttempts: RecoveryAttempt[] = [];
  private readonly maxRecentAttempts = 1000;
  
  /**
   * Record a recovery attempt
   */
  recordRecoveryAttempt(
    tier: string,
    key: string,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    const attempt: RecoveryAttempt = {
      tier,
      key,
      success,
      duration,
      timestamp: Date.now(),
      error
    };
    
    // Add to recent attempts
    this.recentAttempts.push(attempt);
    if (this.recentAttempts.length > this.maxRecentAttempts) {
      this.recentAttempts.shift();
    }
    
    // Update metrics
    this.metrics.totalRecoveries++;
    
    if (success) {
      this.metrics.successfulRecoveries++;
    } else {
      this.metrics.failedRecoveries++;
      
      // Track tier-specific failures
      const currentFailures = this.metrics.tierFailures.get(tier) || 0;
      this.metrics.tierFailures.set(tier, currentFailures + 1);
    }
    
    // Update average recovery time (exponential moving average)
    if (this.metrics.totalRecoveries === 1) {
      this.metrics.averageRecoveryTime = duration;
    } else {
      // Use exponential moving average with alpha = 0.1
      this.metrics.averageRecoveryTime = 
        (0.9 * this.metrics.averageRecoveryTime) + (0.1 * duration);
    }
  }
  
  /**
   * Get overall recovery rate (0-1)
   */
  getRecoveryRate(): number {
    if (this.metrics.totalRecoveries === 0) return 1;
    
    return this.metrics.successfulRecoveries / this.metrics.totalRecoveries;
  }
  
  /**
   * Get recovery rate for a specific tier
   */
  getTierRecoveryRate(tier: string): number {
    const tierAttempts = this.recentAttempts.filter(a => a.tier === tier);
    if (tierAttempts.length === 0) return 1;
    
    const successful = tierAttempts.filter(a => a.success).length;
    return successful / tierAttempts.length;
  }
  
  /**
   * Check if recovery rate is below threshold (should alert)
   */
  shouldAlertOnFailures(threshold: number = 0.8): boolean {
    return this.getRecoveryRate() < threshold;
  }
  
  /**
   * Check if a specific tier should trigger alerts
   */
  shouldAlertOnTierFailures(tier: string, threshold: number = 0.7): boolean {
    return this.getTierRecoveryRate(tier) < threshold;
  }
  
  /**
   * Get metrics for the last N minutes
   */
  getRecentMetrics(minutes: number = 5): {
    attempts: number;
    successes: number;
    failures: number;
    averageTime: number;
    successRate: number;
  } {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentAttempts = this.recentAttempts.filter(a => a.timestamp > cutoff);
    
    if (recentAttempts.length === 0) {
      return {
        attempts: 0,
        successes: 0,
        failures: 0,
        averageTime: 0,
        successRate: 1
      };
    }
    
    const successes = recentAttempts.filter(a => a.success).length;
    const failures = recentAttempts.length - successes;
    const totalTime = recentAttempts.reduce((sum, a) => sum + a.duration, 0);
    const averageTime = totalTime / recentAttempts.length;
    const successRate = successes / recentAttempts.length;
    
    return {
      attempts: recentAttempts.length,
      successes,
      failures,
      averageTime,
      successRate
    };
  }
  
  /**
   * Get tier-specific failure counts
   */
  getTierFailureCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [tier, count] of this.metrics.tierFailures.entries()) {
      counts[tier] = count;
    }
    return counts;
  }
  
  /**
   * Get recent failures for a tier
   */
  getRecentTierFailures(tier: string, minutes: number = 5): RecoveryAttempt[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.recentAttempts.filter(
      a => a.tier === tier && !a.success && a.timestamp > cutoff
    );
  }
  
  /**
   * Get slowest recent operations
   */
  getSlowestOperations(limit: number = 10): RecoveryAttempt[] {
    return [...this.recentAttempts]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }
  
  /**
   * Generate a comprehensive report
   */
  getReport(): string {
    const rate = (this.getRecoveryRate() * 100).toFixed(1);
    const recentMetrics = this.getRecentMetrics(5);
    const recentRate = (recentMetrics.successRate * 100).toFixed(1);
    
    let report = `
Recovery Statistics:
- Total Attempts: ${this.metrics.totalRecoveries}
- Overall Success Rate: ${rate}%
- Recent Success Rate (5min): ${recentRate}%
- Average Recovery Time: ${this.metrics.averageRecoveryTime.toFixed(0)}ms
- Failed Recoveries: ${this.metrics.failedRecoveries}

Recent Activity (Last 5 minutes):
- Attempts: ${recentMetrics.attempts}
- Successes: ${recentMetrics.successes}
- Failures: ${recentMetrics.failures}
- Average Time: ${recentMetrics.averageTime.toFixed(0)}ms

Tier Failure Counts:`;

    const tierFailures = this.getTierFailureCounts();
    if (Object.keys(tierFailures).length === 0) {
      report += '\n  - No tier failures recorded';
    } else {
      for (const [tier, count] of Object.entries(tierFailures)) {
        const tierRate = (this.getTierRecoveryRate(tier) * 100).toFixed(1);
        report += `\n  - ${tier}: ${count} failures (${tierRate}% success rate)`;
      }
    }
    
    return report.trim();
  }
  
  /**
   * Get report in JSON format
   */
  getReportJson(): any {
    const recentMetrics = this.getRecentMetrics(5);
    
    return {
      overall: {
        totalAttempts: this.metrics.totalRecoveries,
        successfulRecoveries: this.metrics.successfulRecoveries,
        failedRecoveries: this.metrics.failedRecoveries,
        successRate: this.getRecoveryRate(),
        averageRecoveryTime: this.metrics.averageRecoveryTime
      },
      recent: {
        ...recentMetrics,
        periodMinutes: 5
      },
      tiers: Object.fromEntries(
        Array.from(this.metrics.tierFailures.keys()).map(tier => [
          tier,
          {
            failures: this.metrics.tierFailures.get(tier) || 0,
            successRate: this.getTierRecoveryRate(tier),
            recentFailures: this.getRecentTierFailures(tier).length
          }
        ])
      ),
      alerts: {
        overallAlert: this.shouldAlertOnFailures(),
        tierAlerts: Object.fromEntries(
          Array.from(this.metrics.tierFailures.keys()).map(tier => [
            tier,
            this.shouldAlertOnTierFailures(tier)
          ])
        )
      }
    };
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = {
      totalRecoveries: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      averageRecoveryTime: 0,
      tierFailures: new Map()
    };
    this.recentAttempts = [];
  }
  
  /**
   * Reset metrics for a specific tier
   */
  resetTier(tier: string): void {
    this.metrics.tierFailures.delete(tier);
    this.recentAttempts = this.recentAttempts.filter(a => a.tier !== tier);
  }
  
  /**
   * Get current metrics snapshot
   */
  getMetrics(): RecoveryMetrics {
    return {
      ...this.metrics,
      tierFailures: new Map(this.metrics.tierFailures)
    };
  }
}