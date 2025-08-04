# Phase 3, Task 3: Basic Performance Monitoring

## Overview
Implement a simple, lightweight performance monitoring system that provides insights into cache performance, API usage, and system health without the complexity of external monitoring systems.

## Objectives
- Track basic performance metrics (response times, hit rates)
- Monitor storage tier health and capacity
- Provide simple CLI dashboard for monitoring
- Add basic alerting for critical issues
- Export metrics in common formats (JSON, CSV)

## Technical Requirements

### Simple Metrics Collector
```typescript
export interface PerformanceMetrics {
  timestamp: number;
  cacheMetrics: {
    hitRate: number;
    totalRequests: number;
    hits: number;
    misses: number;
    avgResponseTime: number;
  };
  storageMetrics: {
    memory: TierMetrics;
    pglite: TierMetrics;
    github: TierMetrics;
  };
  apiMetrics: {
    githubRequests: number;
    rateLimitRemaining: number;
    avgResponseTime: number;
    errors: number;
  };
  systemMetrics: {
    uptime: number;
    memoryUsage: number;
    storageSize: StorageSize;
  };
}

interface TierMetrics {
  available: boolean;
  responseTime: number;
  errorRate: number;
  usage: number;
}

interface StorageSize {
  memory: { used: number; max: number };
  pglite: { used: number; max: number };
}

export class SimpleMetricsCollector {
  private metrics: PerformanceMetrics[] = [];
  private currentMetrics: Partial<PerformanceMetrics>;
  private startTime = Date.now();
  
  constructor(
    private storage: HybridStorage,
    private config: ConfigurationManager
  ) {
    this.currentMetrics = this.initializeMetrics();
    this.startCollectionInterval();
  }
  
  private initializeMetrics(): Partial<PerformanceMetrics> {
    return {
      cacheMetrics: {
        hitRate: 0,
        totalRequests: 0,
        hits: 0,
        misses: 0,
        avgResponseTime: 0
      },
      apiMetrics: {
        githubRequests: 0,
        rateLimitRemaining: 5000,
        avgResponseTime: 0,
        errors: 0
      }
    };
  }
  
  recordCacheAccess(hit: boolean, responseTime: number): void {
    const cache = this.currentMetrics.cacheMetrics!;
    
    cache.totalRequests++;
    if (hit) {
      cache.hits++;
    } else {
      cache.misses++;
    }
    
    // Update average response time
    cache.avgResponseTime = 
      (cache.avgResponseTime * (cache.totalRequests - 1) + responseTime) / 
      cache.totalRequests;
    
    // Update hit rate
    cache.hitRate = cache.totalRequests > 0 
      ? (cache.hits / cache.totalRequests) * 100 
      : 0;
  }
  
  recordApiCall(success: boolean, responseTime: number, rateLimitRemaining?: number): void {
    const api = this.currentMetrics.apiMetrics!;
    
    api.githubRequests++;
    
    if (!success) {
      api.errors++;
    }
    
    // Update average response time
    api.avgResponseTime = 
      (api.avgResponseTime * (api.githubRequests - 1) + responseTime) / 
      api.githubRequests;
    
    if (rateLimitRemaining !== undefined) {
      api.rateLimitRemaining = rateLimitRemaining;
    }
  }
  
  private async collectStorageMetrics(): Promise<void> {
    const storageMetrics: any = {
      memory: await this.collectTierMetrics('memory'),
      pglite: await this.collectTierMetrics('pglite'),
      github: await this.collectTierMetrics('github')
    };
    
    const systemMetrics = {
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage().heapUsed,
      storageSize: await this.getStorageSize()
    };
    
    // Create complete metrics snapshot
    const snapshot: PerformanceMetrics = {
      timestamp: Date.now(),
      cacheMetrics: { ...this.currentMetrics.cacheMetrics! },
      storageMetrics,
      apiMetrics: { ...this.currentMetrics.apiMetrics! },
      systemMetrics
    };
    
    this.metrics.push(snapshot);
    
    // Keep only last hour of metrics
    const cutoff = Date.now() - 3600000;
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
  }
  
  private async collectTierMetrics(tier: string): Promise<TierMetrics> {
    const testKey = `_metrics_test_${tier}`;
    const startTime = Date.now();
    let available = true;
    let errorRate = 0;
    
    try {
      // Test tier availability
      await this.storage.set(testKey, { test: true }, 1000);
      await this.storage.get(testKey);
      await this.storage.delete(testKey);
    } catch (error) {
      available = false;
      errorRate = 1;
    }
    
    const responseTime = Date.now() - startTime;
    
    // Get usage percentage (simplified)
    const usage = tier === 'memory' ? 50 : tier === 'pglite' ? 30 : 0;
    
    return {
      available,
      responseTime,
      errorRate,
      usage
    };
  }
  
  private async getStorageSize(): Promise<StorageSize> {
    const stats = await this.storage.getStats();
    
    return {
      memory: {
        used: stats.tiers.memory.size,
        max: this.config.get('storage.memory.maxSize')
      },
      pglite: {
        used: stats.tiers.pglite.size,
        max: this.config.get('storage.pglite.maxSize')
      }
    };
  }
  
  private startCollectionInterval(): void {
    setInterval(() => {
      this.collectStorageMetrics().catch(error => {
        logger.error('Failed to collect metrics:', error);
      });
    }, 60000); // Collect every minute
  }
  
  getCurrentMetrics(): PerformanceMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }
  
  getMetricsHistory(minutes: number = 60): PerformanceMetrics[] {
    const cutoff = Date.now() - (minutes * 60000);
    return this.metrics.filter(m => m.timestamp > cutoff);
  }
  
  exportMetrics(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2);
    }
    
    // CSV export
    const headers = [
      'timestamp',
      'cache_hit_rate',
      'total_requests',
      'avg_response_time',
      'github_requests',
      'rate_limit_remaining',
      'memory_usage_mb'
    ];
    
    const rows = this.metrics.map(m => [
      new Date(m.timestamp).toISOString(),
      m.cacheMetrics.hitRate.toFixed(2),
      m.cacheMetrics.totalRequests,
      m.cacheMetrics.avgResponseTime.toFixed(2),
      m.apiMetrics.githubRequests,
      m.apiMetrics.rateLimitRemaining,
      (m.systemMetrics.memoryUsage / 1024 / 1024).toFixed(2)
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}
```

### Simple Alert System
```typescript
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

export class SimpleAlertManager {
  private alerts: Map<string, Alert> = new Map();
  private thresholds: AlertThresholds;
  
  constructor(private config: ConfigurationManager) {
    this.thresholds = {
      cacheHitRate: 50, // Alert if below 50%
      errorRate: 10,    // Alert if above 10%
      storageUsage: 80, // Alert if above 80%
      rateLimitRemaining: 100, // Alert if below 100
      tierResponseTime: 5000 // Alert if above 5 seconds
    };
  }
  
  checkMetrics(metrics: PerformanceMetrics): Alert[] {
    const newAlerts: Alert[] = [];
    
    // Check cache hit rate
    if (metrics.cacheMetrics.hitRate < this.thresholds.cacheHitRate) {
      newAlerts.push(this.createAlert(
        'low-cache-hit-rate',
        'warning',
        `Cache hit rate is ${metrics.cacheMetrics.hitRate.toFixed(1)}%`
      ));
    }
    
    // Check API rate limit
    if (metrics.apiMetrics.rateLimitRemaining < this.thresholds.rateLimitRemaining) {
      newAlerts.push(this.createAlert(
        'rate-limit-low',
        'critical',
        `GitHub API rate limit low: ${metrics.apiMetrics.rateLimitRemaining} remaining`
      ));
    }
    
    // Check storage capacity
    const memoryUsage = (metrics.systemMetrics.storageSize.memory.used / 
                        metrics.systemMetrics.storageSize.memory.max) * 100;
    
    if (memoryUsage > this.thresholds.storageUsage) {
      newAlerts.push(this.createAlert(
        'storage-near-capacity',
        'warning',
        `Memory storage at ${memoryUsage.toFixed(1)}% capacity`
      ));
    }
    
    // Check tier availability
    for (const [tier, tierMetrics] of Object.entries(metrics.storageMetrics)) {
      if (!tierMetrics.available) {
        newAlerts.push(this.createAlert(
          'tier-unavailable',
          'critical',
          `Storage tier '${tier}' is unavailable`
        ));
      }
    }
    
    // Update alerts
    this.updateAlerts(newAlerts);
    
    return this.getActiveAlerts();
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
    const activeTypes = new Set(newAlerts.map(a => a.type));
    
    for (const alert of this.alerts.values()) {
      if (!activeTypes.has(alert.type) && !alert.resolved) {
        alert.resolved = true;
      }
    }
    
    // Add new alerts
    for (const alert of newAlerts) {
      const existing = Array.from(this.alerts.values())
        .find(a => a.type === alert.type && !a.resolved);
      
      if (!existing) {
        this.alerts.set(alert.id, alert);
      }
    }
  }
  
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(a => !a.resolved)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

interface AlertThresholds {
  cacheHitRate: number;
  errorRate: number;
  storageUsage: number;
  rateLimitRemaining: number;
  tierResponseTime: number;
}
```

### CLI Monitoring Dashboard
```typescript
export async function showMonitoringDashboard(
  options: { 
    watch?: boolean; 
    interval?: number;
    export?: 'json' | 'csv';
  } = {}
): Promise<void> {
  const collector = new SimpleMetricsCollector(getStorage(), getConfig());
  const alertManager = new SimpleAlertManager(getConfig());
  
  if (options.export) {
    // Export metrics and exit
    const data = collector.exportMetrics(options.export);
    const filename = `metrics-${Date.now()}.${options.export}`;
    
    await fs.writeFile(filename, data);
    console.log(chalk.green(`✓ Metrics exported to ${filename}`));
    return;
  }
  
  const displayDashboard = () => {
    console.clear();
    
    const metrics = collector.getCurrentMetrics();
    if (!metrics) {
      console.log(chalk.yellow('No metrics available yet...'));
      return;
    }
    
    // Header
    console.log(chalk.bold.blue('🎯 Performance Monitoring Dashboard'));
    console.log(chalk.gray('─'.repeat(60)));
    
    // Cache Performance
    console.log(chalk.bold('\n📊 Cache Performance'));
    const cacheTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['cyan'] }
    });
    
    cacheTable.push(
      ['Hit Rate', `${metrics.cacheMetrics.hitRate.toFixed(1)}%`],
      ['Total Requests', metrics.cacheMetrics.totalRequests.toLocaleString()],
      ['Hits / Misses', `${metrics.cacheMetrics.hits} / ${metrics.cacheMetrics.misses}`],
      ['Avg Response Time', `${metrics.cacheMetrics.avgResponseTime.toFixed(0)}ms`]
    );
    
    console.log(cacheTable.toString());
    
    // Storage Health
    console.log(chalk.bold('\n💾 Storage Health'));
    const storageTable = new Table({
      head: ['Tier', 'Status', 'Response Time', 'Usage'],
      style: { head: ['cyan'] }
    });
    
    for (const [tier, tierMetrics] of Object.entries(metrics.storageMetrics)) {
      const status = tierMetrics.available 
        ? chalk.green('✓ Online') 
        : chalk.red('✗ Offline');
      
      storageTable.push([
        tier.charAt(0).toUpperCase() + tier.slice(1),
        status,
        `${tierMetrics.responseTime}ms`,
        `${tierMetrics.usage}%`
      ]);
    }
    
    console.log(storageTable.toString());
    
    // GitHub API Status
    console.log(chalk.bold('\n🌐 GitHub API Status'));
    console.log(`Requests: ${metrics.apiMetrics.githubRequests}`);
    console.log(`Rate Limit: ${metrics.apiMetrics.rateLimitRemaining}/5000`);
    console.log(`Avg Response: ${metrics.apiMetrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`Errors: ${metrics.apiMetrics.errors}`);
    
    // System Info
    console.log(chalk.bold('\n💻 System Info'));
    console.log(`Uptime: ${formatDuration(metrics.systemMetrics.uptime)}`);
    console.log(`Memory: ${(metrics.systemMetrics.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
    
    // Active Alerts
    const alerts = alertManager.checkMetrics(metrics);
    if (alerts.length > 0) {
      console.log(chalk.bold.red('\n⚠️  Active Alerts'));
      
      alerts.forEach(alert => {
        const icon = alert.severity === 'critical' ? '🚨' : '⚠️';
        const color = alert.severity === 'critical' ? 'red' : 'yellow';
        console.log(chalk[color](`${icon} ${alert.message}`));
      });
    } else {
      console.log(chalk.bold.green('\n✓ No Active Alerts'));
    }
    
    if (options.watch) {
      console.log(chalk.gray(`\nRefreshing every ${options.interval || 5} seconds... (Ctrl+C to exit)`));
    }
  };
  
  displayDashboard();
  
  if (options.watch) {
    const interval = setInterval(displayDashboard, (options.interval || 5) * 1000);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log(chalk.yellow('\n\nMonitoring stopped.'));
      process.exit(0);
    });
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
```

### Health Check Endpoint
```typescript
export class HealthChecker {
  constructor(
    private storage: HybridStorage,
    private collector: SimpleMetricsCollector
  ) {}
  
  async getHealthStatus(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkStorage(),
      this.checkGitHubApi(),
      this.checkCachePerformance()
    ]);
    
    const overall = checks.every(c => c.healthy) ? 'healthy' : 
                   checks.some(c => !c.healthy && c.severity === 'critical') ? 'unhealthy' : 
                   'degraded';
    
    return {
      status: overall,
      timestamp: new Date().toISOString(),
      checks,
      metrics: this.collector.getCurrentMetrics()
    };
  }
  
  private async checkStorage(): Promise<HealthCheck> {
    try {
      const stats = await this.storage.getStats();
      const healthy = stats.healthy;
      
      return {
        name: 'storage',
        healthy,
        message: healthy ? 'All storage tiers operational' : 'Storage degraded',
        severity: healthy ? 'info' : 'warning'
      };
    } catch (error) {
      return {
        name: 'storage',
        healthy: false,
        message: `Storage check failed: ${error.message}`,
        severity: 'critical'
      };
    }
  }
  
  private async checkGitHubApi(): Promise<HealthCheck> {
    const metrics = this.collector.getCurrentMetrics();
    
    if (!metrics) {
      return {
        name: 'github-api',
        healthy: true,
        message: 'No metrics available',
        severity: 'info'
      };
    }
    
    const healthy = metrics.apiMetrics.rateLimitRemaining > 100 &&
                   metrics.apiMetrics.errors < 10;
    
    return {
      name: 'github-api',
      healthy,
      message: healthy ? 'GitHub API operational' : 'GitHub API issues detected',
      severity: healthy ? 'info' : 'warning'
    };
  }
  
  private async checkCachePerformance(): Promise<HealthCheck> {
    const metrics = this.collector.getCurrentMetrics();
    
    if (!metrics) {
      return {
        name: 'cache',
        healthy: true,
        message: 'No metrics available',
        severity: 'info'
      };
    }
    
    const healthy = metrics.cacheMetrics.hitRate > 30;
    
    return {
      name: 'cache',
      healthy,
      message: `Cache hit rate: ${metrics.cacheMetrics.hitRate.toFixed(1)}%`,
      severity: healthy ? 'info' : 'warning'
    };
  }
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  metrics: PerformanceMetrics | null;
}

interface HealthCheck {
  name: string;
  healthy: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}
```

## Acceptance Criteria
- [ ] Basic metrics collection works reliably
- [ ] Storage tier health monitored accurately
- [ ] CLI dashboard displays real-time metrics
- [ ] Alerts trigger for threshold violations
- [ ] Metrics export in JSON and CSV formats
- [ ] Health check endpoint provides accurate status
- [ ] Performance impact minimal (<1% overhead)
- [ ] Watch mode updates dashboard regularly

## Testing Requirements
- Unit tests for metrics collection
- Alert threshold tests
- Dashboard rendering tests
- Export format validation tests
- Health check accuracy tests
- Performance overhead tests

## Estimated Effort
- 6-8 hours

## Dependencies
- Existing storage system
- CLI infrastructure
- Table formatting library (cli-table3)

## Notes
- Keep metrics lightweight - no external dependencies
- Focus on actionable metrics only
- Consider adding metric retention configuration
- Future: Add simple webhook for alerts